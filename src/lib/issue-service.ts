import { Prisma, type IssueCloseReason, type IssueKind, type IssueSeverity, type IssueStatus, type TaskPriority } from "@prisma/client";
import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { ExpectedError } from "@/lib/expected-error";
import type { ArtifactInput } from "@/lib/artifact-schema";
import type { TaskActor } from "@/lib/task-service";

// Work-order alphabet: digits and uppercase minus the lookalikes (0/O, 1/I/L).
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 7;
const CODE_RETRIES = 3;

/** Attachments arrive pre-validated through the shared artifact contract; storageKey is reserved for the binary-upload slice. */
export type NewIssueArtifact = ArtifactInput & { storageKey?: string };

/**
 * Lock a task row so the close gate and issue assignment cannot interleave.
 * Both paths take this lock before validating, so neither can slip past the
 * other's check regardless of arrival order. Lives here because assignment
 * (this module) and the close gate (task-service) are the two contenders.
 */
export async function lockTaskRow(tx: Prisma.TransactionClient, taskId: string) {
  await tx.$queryRaw`SELECT id FROM "Task" WHERE id = CAST(${taskId} AS uuid) FOR UPDATE`;
}

/** The close gate: no task completes while issues attached to it are OPEN or IN TRIAGE. */
export async function assertNoOpenIssues(tx: Prisma.TransactionClient, taskId: string) {
  const blocking = await tx.issue.findMany({
    where: { assignedTaskId: taskId, status: { in: ["OPEN", "TRIAGED"] } },
    select: { code: true, title: true },
    orderBy: { code: "asc" }
  });
  if (!blocking.length) return;
  const shown = blocking.slice(0, 5).map((issue) => `${issue.code} "${issue.title}"`).join(", ");
  const extra = blocking.length > 5 ? ` and ${blocking.length - 5} more` : "";
  throw new ExpectedError(`Resolve attached issues before completing this task: ${shown}${extra}`);
}

function randomCode() {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function isCodeCollision(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034") &&
    JSON.stringify(error.meta ?? {}).includes("code")
  );
}

export async function createIssue(
  input: {
    workspaceId: string;
    projectId?: string;
    kind?: IssueKind;
    title: string;
    details?: string;
    severity?: IssueSeverity;
    reportedBy?: string;
    sourceCandidateId?: string;
    attachments?: NewIssueArtifact[];
  },
  actor: TaskActor
) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        // Projects name the affected system. When the filer does not know one,
        // the issue lands in the workspace's UNASSIGNED bucket.
        let projectId = input.projectId;
        if (projectId) {
          const project = await tx.project.findFirst({
            where: { id: projectId, workspaceId: input.workspaceId },
            select: { id: true }
          });
          if (!project) throw new ExpectedError("Project must belong to the same workspace as the issue");
        } else {
          const bucket = await tx.project.findFirst({
            where: { workspaceId: input.workspaceId, key: "UNASSIGNED", archivedAt: null },
            select: { id: true }
          });
          if (!bucket) throw new ExpectedError("No UNASSIGNED project exists in this workspace; create one or name a project");
          projectId = bucket.id;
        }
        if (input.sourceCandidateId) {
          const candidate = await tx.journalCandidate.findFirst({
            where: { id: input.sourceCandidateId, entry: { workspaceId: input.workspaceId } },
            select: { id: true }
          });
          if (!candidate) throw new ExpectedError("Journal candidate must belong to the same workspace as the issue");
        }

        const issue = await tx.issue.create({
          data: {
            workspaceId: input.workspaceId,
            code: randomCode(),
            kind: input.kind ?? "BUG",
            title: input.title,
            details: input.details,
            severity: input.severity ?? "MEDIUM",
            projectId,
            sourceCandidateId: input.sourceCandidateId,
            reportedBy: input.reportedBy ?? actor.label,
            artifacts: input.attachments?.length
              ? { create: input.attachments.map((artifact) => ({ ...artifact, workspaceId: input.workspaceId, createdBy: actor.label })) }
              : undefined
          },
          include: { artifacts: true }
        });
        await tx.activity.create({
          data: {
            workspaceId: issue.workspaceId,
            projectId: issue.projectId,
            issueId: issue.id,
            actorType: actor.type,
            actorLabel: actor.label,
            action: "issue.filed",
            summary: `Filed issue ${issue.code}: ${issue.title}`,
            metadata: {
              code: issue.code,
              kind: issue.kind,
              severity: issue.severity,
              attachments: issue.artifacts.length,
              sourceCandidateId: issue.sourceCandidateId,
              version: issue.version
            }
          }
        });
        return issue;
      });
    } catch (error) {
      // Codes are drawn randomly against a unique constraint; a collision just
      // re-draws inside a fresh transaction.
      if (attempt < CODE_RETRIES && isCodeCollision(error)) continue;
      throw error;
    }
  }
}

export async function updateIssue(
  id: string,
  version: number,
  patch: {
    title?: string;
    details?: string | null;
    kind?: IssueKind;
    severity?: IssueSeverity;
    projectId?: string;
    duplicateOfId?: string | null;
  },
  actor: TaskActor
) {
  return db.$transaction(async (tx) => {
    const current = await tx.issue.findUniqueOrThrow({ where: { id } });
    if (current.status === "CLOSED") throw new ExpectedError("Reopen this issue before editing it");
    if (patch.projectId && patch.projectId !== current.projectId && current.assignedTaskId) {
      throw new ExpectedError("Reassign this issue before moving it to another project");
    }
    if (patch.projectId) {
      const project = await tx.project.findFirst({
        where: { id: patch.projectId, workspaceId: current.workspaceId },
        select: { id: true }
      });
      if (!project) throw new ExpectedError("Project must belong to the same workspace as the issue");
    }
    if (patch.duplicateOfId) {
      if (patch.duplicateOfId === id) throw new ExpectedError("An issue cannot be a duplicate of itself");
      const original = await tx.issue.findFirst({
        where: { id: patch.duplicateOfId, workspaceId: current.workspaceId },
        select: { id: true, duplicateOfId: true }
      });
      if (!original) throw new ExpectedError("Duplicate target must be an issue in the same workspace");
      if (original.duplicateOfId === id) throw new ExpectedError("Issues cannot be duplicates of each other");
    }

    const result = await tx.issue.updateMany({
      where: { id, version },
      data: { ...patch, version: { increment: 1 } }
    });
    if (result.count !== 1) throw new ExpectedError("Issue changed since it was loaded");
    const issue = await tx.issue.findUniqueOrThrow({ where: { id } });
    await tx.activity.create({
      data: {
        workspaceId: issue.workspaceId,
        projectId: issue.projectId,
        issueId: issue.id,
        actorType: actor.type,
        actorLabel: actor.label,
        action: "issue.updated",
        summary: `Updated issue ${issue.code}: ${issue.title}`,
        metadata: { changes: patch, version: issue.version }
      }
    });
    return issue;
  });
}

export async function issueLifecycle(
  id: string,
  version: number,
  action: "triage" | "resolve" | "verify" | "reopen",
  payload: {
    severity?: IssueSeverity;
    closeReason?: "FIXED" | "WONT_FIX" | "DUPLICATE" | "NOT_A_BUG";
    note?: string;
    duplicateOfId?: string;
  },
  actor: TaskActor
) {
  return db.$transaction(async (tx) => {
    const current = await tx.issue.findUniqueOrThrow({ where: { id } });
    const now = new Date();

    if (action === "triage") {
      if (current.status !== "OPEN") throw new ExpectedError("Only an OPEN issue can move to triage");
      const result = await tx.issue.updateMany({
        where: { id, version },
        data: { status: "TRIAGED", severity: payload.severity, version: { increment: 1 } }
      });
      if (result.count !== 1) throw new ExpectedError("Issue changed since it was loaded");
      const issue = await tx.issue.findUniqueOrThrow({ where: { id } });
      await tx.activity.create({
        data: {
          workspaceId: issue.workspaceId, projectId: issue.projectId, issueId: issue.id,
          actorType: actor.type, actorLabel: actor.label,
          action: "issue.triaged",
          summary: `Triaged issue ${issue.code}: ${issue.title}`,
          metadata: { severity: issue.severity, version: issue.version }
        }
      });
      return issue;
    }

    if (action === "resolve") {
      if (current.status !== "OPEN" && current.status !== "TRIAGED") {
        throw new ExpectedError("Only an OPEN or IN TRIAGE issue can be resolved");
      }
      const closeReason = payload.closeReason ?? "FIXED";
      if (closeReason === "FIXED" && !payload.note?.trim()) {
        throw new ExpectedError("Resolving as FIXED requires a note describing the fix");
      }
      if (closeReason === "DUPLICATE") {
        if (!payload.duplicateOfId) throw new ExpectedError("Resolving as DUPLICATE requires the original issue");
        if (payload.duplicateOfId === id) throw new ExpectedError("An issue cannot be a duplicate of itself");
        const original = await tx.issue.findFirst({
          where: { id: payload.duplicateOfId, workspaceId: current.workspaceId },
          select: { id: true, duplicateOfId: true }
        });
        if (!original) throw new ExpectedError("Duplicate target must be an issue in the same workspace");
        if (original.duplicateOfId === id) throw new ExpectedError("Issues cannot be duplicates of each other");
      }
      const resolved = closeReason === "FIXED";
      const result = await tx.issue.updateMany({
        where: { id, version },
        data: {
          status: resolved ? "RESOLVED" : "CLOSED",
          closeReason,
          resolvedAt: resolved ? now : null,
          closedAt: resolved ? null : now,
          version: { increment: 1 }
        }
      });
      if (result.count !== 1) throw new ExpectedError("Issue changed since it was loaded");
      const issue = await tx.issue.findUniqueOrThrow({ where: { id } });
      await tx.activity.create({
        data: {
          workspaceId: issue.workspaceId, projectId: issue.projectId, issueId: issue.id,
          actorType: actor.type, actorLabel: actor.label,
          action: "issue.resolved",
          summary: resolved
            ? `Resolved issue ${issue.code}: ${issue.title}`
            : `Closed issue ${issue.code}: ${issue.title} (${closeReason})`,
          metadata: {
            closeReason, note: payload.note, duplicateOfId: payload.duplicateOfId,
            previousStatus: current.status, version: issue.version
          }
        }
      });
      await cascadeDuplicateClosures(tx, issue, closeReason, now, actor);
      return issue;
    }

    if (action === "verify") {
      if (current.status !== "RESOLVED") throw new ExpectedError("Only a RESOLVED issue can be verified closed");
      const result = await tx.issue.updateMany({
        where: { id, version },
        data: { status: "CLOSED", closedAt: now, version: { increment: 1 } }
      });
      if (result.count !== 1) throw new ExpectedError("Issue changed since it was loaded");
      const issue = await tx.issue.findUniqueOrThrow({ where: { id } });
      await tx.activity.create({
        data: {
          workspaceId: issue.workspaceId, projectId: issue.projectId, issueId: issue.id,
          actorType: actor.type, actorLabel: actor.label,
          action: "issue.verified",
          summary: `Verified issue ${issue.code}: ${issue.title}`,
          metadata: { closeReason: current.closeReason, version: issue.version }
        }
      });
      await cascadeDuplicateClosures(tx, issue, current.closeReason ?? "FIXED", now, actor);
      return issue;
    }

    // reopen
    if (current.status !== "RESOLVED" && current.status !== "CLOSED") {
      throw new ExpectedError("Only a RESOLVED or CLOSED issue can be reopened");
    }
    if (!payload.note?.trim()) throw new ExpectedError("Reopening an issue requires a note explaining what came back");
    const result = await tx.issue.updateMany({
      where: { id, version },
      data: {
        status: "OPEN",
        assignedTaskId: null,
        closeReason: null,
        resolvedAt: null,
        closedAt: null,
        version: { increment: 1 }
      }
    });
    if (result.count !== 1) throw new ExpectedError("Issue changed since it was loaded");
    const issue = await tx.issue.findUniqueOrThrow({ where: { id } });
    await tx.activity.create({
      data: {
        workspaceId: issue.workspaceId, projectId: issue.projectId, issueId: issue.id,
        actorType: actor.type, actorLabel: actor.label,
        action: "issue.reopened",
        summary: `Reopened issue ${issue.code}: ${issue.title}`,
        metadata: {
          note: payload.note,
          previousStatus: current.status,
          previousTaskId: current.assignedTaskId,
          version: issue.version
        }
      }
    });
    return issue;
  });
}

/** Closing an original closes its still-open duplicates with the same reason. */
async function cascadeDuplicateClosures(
  tx: Prisma.TransactionClient,
  original: { id: string; workspaceId: string; code: string },
  closeReason: IssueCloseReason,
  now: Date,
  actor: TaskActor
) {
  const openDuplicates = await tx.issue.findMany({
    where: { duplicateOfId: original.id, status: { in: ["OPEN", "TRIAGED"] as IssueStatus[] } }
  });
  for (const duplicate of openDuplicates) {
    await tx.issue.update({
      where: { id: duplicate.id },
      data: { status: "CLOSED", closeReason, closedAt: now, version: { increment: 1 } }
    });
    await tx.activity.create({
      data: {
        workspaceId: duplicate.workspaceId, projectId: duplicate.projectId, issueId: duplicate.id,
        actorType: actor.type, actorLabel: actor.label,
        action: "issue.resolved",
        summary: `Closed duplicate ${duplicate.code} of ${original.code} (${closeReason})`,
        metadata: { closeReason, duplicateOfId: original.id, cascaded: true, version: duplicate.version + 1 }
      }
    });
  }
}

export async function assignIssue(
  id: string,
  version: number,
  payload: { taskId: string } | { newTask: { title: string; description?: string; priority?: TaskPriority } },
  actor: TaskActor
) {
  return db.$transaction(async (tx) => {
    const issue = await tx.issue.findUniqueOrThrow({ where: { id } });
    if (issue.status !== "OPEN" && issue.status !== "TRIAGED") {
      throw new ExpectedError("Reopen this issue before assigning it to a task");
    }

    let taskId: string;
    let createdTask: Awaited<ReturnType<typeof tx.task.create>> | null = null;
    if ("newTask" in payload) {
      createdTask = await tx.task.create({
        data: {
          workspaceId: issue.workspaceId,
          projectId: issue.projectId,
          title: payload.newTask.title,
          description: payload.newTask.description,
          priority: payload.newTask.priority ?? "MEDIUM",
          createdBy: actor.label
        }
      });
      await tx.activity.create({
        data: {
          workspaceId: createdTask.workspaceId, projectId: createdTask.projectId, taskId: createdTask.id,
          actorType: actor.type, actorLabel: actor.label,
          action: "task.created",
          summary: `Created task: ${createdTask.title}`
        }
      });
      taskId = createdTask.id;
    } else {
      taskId = payload.taskId;
    }
    if (issue.assignedTaskId === taskId) throw new ExpectedError("Issue is already assigned to this task");

    // Lock before validating task state so a concurrent completion cannot
    // interleave between the check and the attach.
    await lockTaskRow(tx, taskId);
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task || task.workspaceId !== issue.workspaceId || task.archivedAt) {
      throw new ExpectedError("Task must be an active task in the same workspace as the issue");
    }
    if (task.status === "DONE" || task.status === "CANCELED") {
      throw new ExpectedError("Issues cannot attach to a DONE or CANCELED task");
    }
    if (task.projectId !== issue.projectId) {
      throw new ExpectedError("Attach this issue to a task in its own project, or assign it to a new task");
    }

    const result = await tx.issue.updateMany({
      where: { id: issue.id, version },
      data: { assignedTaskId: taskId, status: "TRIAGED", version: { increment: 1 } }
    });
    if (result.count !== 1) throw new ExpectedError("Issue changed since it was loaded");
    await tx.activity.create({
      data: {
        workspaceId: issue.workspaceId, projectId: issue.projectId, issueId: issue.id, taskId,
        actorType: actor.type, actorLabel: actor.label,
        action: "issue.assigned",
        summary: createdTask
          ? `Assigned issue ${issue.code} to new task: ${createdTask.title}`
          : `Assigned issue ${issue.code} to task: ${task.title}`,
        metadata: {
          taskId,
          createdTask: Boolean(createdTask),
          previousTaskId: issue.assignedTaskId,
          version: issue.version + 1
        }
      }
    });
    return tx.issue.findUniqueOrThrow({ where: { id: issue.id }, include: { assignedTask: true } });
  });
}

export async function listIssues(
  workspaceId: string,
  filters: {
    projectId?: string;
    status?: IssueStatus;
    severity?: IssueSeverity;
    kind?: IssueKind;
    assignedTaskId?: string;
    unassignedOnly?: boolean;
    limit?: number;
  } = {}
) {
  return db.issue.findMany({
    where: {
      workspaceId,
      projectId: filters.projectId,
      status: filters.status,
      severity: filters.severity,
      kind: filters.kind,
      assignedTaskId: filters.unassignedOnly ? null : filters.assignedTaskId
    },
    include: {
      project: { select: { id: true, key: true, name: true } },
      assignedTask: { select: { id: true, title: true, status: true } },
      duplicateOf: { select: { id: true, code: true, title: true } },
      artifacts: { where: { archivedAt: null }, orderBy: { createdAt: "desc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 30 }
    },
    orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
    take: Math.min(Math.max(filters.limit ?? 200, 1), 201)
  });
}

export async function issueContext(workspaceId: string, id: string) {
  return db.issue.findFirstOrThrow({
    where: { id, workspaceId },
    include: {
      project: { select: { id: true, key: true, name: true } },
      assignedTask: { select: { id: true, title: true, status: true, version: true } },
      duplicateOf: { select: { id: true, code: true, title: true, status: true } },
      duplicates: { select: { id: true, code: true, title: true, status: true } },
      sourceCandidate: { select: { id: true, kind: true, summary: true } },
      artifacts: { where: { archivedAt: null }, orderBy: { createdAt: "desc" } },
      activities: {
        orderBy: { createdAt: "desc" }, take: 50,
        include: {
          project: { select: { id: true, key: true, name: true } },
          task: { select: { id: true, title: true } },
          issue: { select: { id: true, code: true, title: true } },
          tag: { select: { id: true, name: true } },
          artifact: { select: { id: true, title: true, kind: true } },
          journalEntry: { select: { id: true, entryDate: true, title: true } },
          journalContribution: { select: { id: true, authorLabel: true } },
          journalCandidate: { select: { id: true, summary: true, kind: true } }
        }
      }
    }
  });
}
