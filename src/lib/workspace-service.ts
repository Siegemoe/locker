import type { ArtifactKind, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ExpectedError } from "@/lib/expected-error";
import { journalDateString } from "@/lib/journal-service";
import type { TaskActor } from "@/lib/task-service";

/** The artifact wire shape — the one place the 8 public fields are named. */
export function serializeArtifact(artifact: {
  id: string; kind: ArtifactKind; title: string; url: string | null; textContent: string | null;
  fileName: string | null; mimeType: string | null; sizeBytes: number | null;
}) {
  return {
    id: artifact.id, kind: artifact.kind, title: artifact.title, url: artifact.url,
    textContent: artifact.textContent, fileName: artifact.fileName,
    mimeType: artifact.mimeType, sizeBytes: artifact.sizeBytes
  };
}

export async function createProject(
  input: { workspaceId: string; key: string; name: string; description?: string; color?: string },
  actor: TaskActor
) {
  return db.$transaction(async (tx) => {
    const project = await tx.project.create({ data: input });
    await tx.activity.create({
      data: {
        workspaceId: project.workspaceId, projectId: project.id,
        actorType: actor.type, actorLabel: actor.label,
        action: "project.created", summary: `Created project: ${project.key} · ${project.name}`
      }
    });
    return project;
  });
}

export async function updateProject(
  id: string,
  patch: { key?: string; name?: string; description?: string | null; color?: string | null },
  actor: TaskActor
) {
  return db.$transaction(async (tx) => {
    const before = await tx.project.findUniqueOrThrow({ where: { id } });
    const project = await tx.project.update({ where: { id }, data: patch });
    await tx.activity.create({
      data: {
        workspaceId: project.workspaceId, projectId: project.id,
        actorType: actor.type, actorLabel: actor.label,
        action: "project.updated", summary: `Updated project: ${project.key} · ${project.name}`,
        metadata: { before, changes: patch }
      }
    });
    return project;
  });
}

export async function archiveProject(id: string, actor: TaskActor) {
  return db.$transaction(async (tx) => {
    const project = await tx.project.update({ where: { id }, data: { archivedAt: new Date(), status: "ARCHIVED" } });
    await tx.activity.create({
      data: {
        workspaceId: project.workspaceId, projectId: project.id,
        actorType: actor.type, actorLabel: actor.label,
        action: "project.archived", summary: `Archived project filter: ${project.key} · ${project.name}`
      }
    });
    return project;
  });
}

export async function restoreProject(id: string, actor: TaskActor) {
  return db.$transaction(async (tx) => {
    const project = await tx.project.update({ where: { id }, data: { archivedAt: null, status: "ACTIVE" } });
    await tx.activity.create({
      data: {
        workspaceId: project.workspaceId, projectId: project.id,
        actorType: actor.type, actorLabel: actor.label,
        action: "project.restored", summary: `Restored project filter: ${project.key} · ${project.name}`
      }
    });
    return project;
  });
}

export async function deleteEmptyProject(id: string, actor: TaskActor) {
  return db.$transaction(async (tx) => {
    const project = await tx.project.findUniqueOrThrow({ where: { id } });
    if (project.key === "UNASSIGNED") {
      throw new ExpectedError("The UNASSIGNED project is the default bucket for new issues and cannot be deleted");
    }
    const taskCount = await tx.task.count({ where: { projectId: id } });
    if (taskCount) throw new ExpectedError("Archive this project or reassign its tasks before deleting it");
    const issueCount = await tx.issue.count({ where: { projectId: id } });
    if (issueCount) throw new ExpectedError("Archive this project or move its issues before deleting it");
    await tx.activity.create({
      data: {
        workspaceId: project.workspaceId,
        actorType: actor.type, actorLabel: actor.label,
        action: "project.deleted", summary: `Deleted empty project: ${project.key} · ${project.name}`,
        metadata: { projectId: project.id, key: project.key, name: project.name }
      }
    });
    await tx.project.delete({ where: { id } });
    return { id };
  });
}

export async function createTag(
  input: { workspaceId: string; name: string; color?: string },
  actor: TaskActor
) {
  return db.$transaction(async (tx) => {
    const tag = await tx.tag.create({ data: input });
    await tx.activity.create({
      data: {
        workspaceId: tag.workspaceId, tagId: tag.id,
        actorType: actor.type, actorLabel: actor.label,
        action: "tag.created", summary: `Created tag: ${tag.name}`
      }
    });
    return tag;
  });
}

export async function updateTag(id: string, patch: { name?: string; color?: string | null }, actor: TaskActor) {
  return db.$transaction(async (tx) => {
    const before = await tx.tag.findUniqueOrThrow({ where: { id } });
    const tag = await tx.tag.update({ where: { id }, data: patch });
    await tx.activity.create({
      data: {
        workspaceId: tag.workspaceId, tagId: tag.id,
        actorType: actor.type, actorLabel: actor.label,
        action: "tag.updated", summary: `Updated tag: ${tag.name}`, metadata: { before, changes: patch }
      }
    });
    return tag;
  });
}

export async function archiveTag(id: string, actor: TaskActor) {
  return db.$transaction(async (tx) => {
    const tag = await tx.tag.update({ where: { id }, data: { archivedAt: new Date() } });
    await tx.activity.create({
      data: {
        workspaceId: tag.workspaceId, tagId: tag.id,
        actorType: actor.type, actorLabel: actor.label,
        action: "tag.archived", summary: `Archived tag filter: ${tag.name}`
      }
    });
    return tag;
  });
}

export async function createArtifact(
  input: {
    taskId?: string; issueId?: string; kind: ArtifactKind; title: string; url?: string; textContent?: string;
    fileName?: string; mimeType?: string; sizeBytes?: number; storageKey?: string;
  },
  actor: TaskActor
) {
  return db.$transaction(async (tx) => {
    if (Boolean(input.taskId) === Boolean(input.issueId)) {
      throw new ExpectedError("An artifact needs exactly one owner: a task or an issue");
    }
    const task = input.taskId ? await tx.task.findUniqueOrThrow({ where: { id: input.taskId } }) : null;
    const issue = input.issueId ? await tx.issue.findUniqueOrThrow({ where: { id: input.issueId } }) : null;
    const artifact = await tx.artifact.create({
      data: { ...input, workspaceId: task?.workspaceId ?? issue!.workspaceId, createdBy: actor.label }
    });
    await tx.activity.create({
      data: {
        workspaceId: artifact.workspaceId,
        projectId: task?.projectId ?? issue?.projectId,
        taskId: task?.id, issueId: issue?.id, artifactId: artifact.id,
        actorType: actor.type, actorLabel: actor.label,
        action: "artifact.created", summary: `Attached ${artifact.kind.toLowerCase()}: ${artifact.title}`,
        metadata: { kind: artifact.kind, url: artifact.url, fileName: artifact.fileName, mimeType: artifact.mimeType, sizeBytes: artifact.sizeBytes }
      }
    });
    return artifact;
  });
}

export async function archiveArtifact(id: string, actor: TaskActor) {
  return db.$transaction(async (tx) => {
    const current = await tx.artifact.findUniqueOrThrow({ where: { id }, include: { task: true, issue: true } });
    if (current.archivedAt) throw new ExpectedError("Artifact is already removed from active context");
    const artifact = await tx.artifact.update({
      where: { id },
      data: { archivedAt: new Date() },
      include: { task: true, issue: true }
    });
    await tx.activity.create({
      data: {
        workspaceId: artifact.workspaceId,
        projectId: artifact.task?.projectId ?? artifact.issue?.projectId,
        taskId: artifact.taskId, issueId: artifact.issueId, artifactId: artifact.id,
        actorType: actor.type, actorLabel: actor.label,
        action: "artifact.removed", summary: `Removed artifact from active context: ${artifact.title}`
      }
    });
    return artifact;
  });
}

/** The relations an activity event carries on the wire; issue context reuses the same shape. */
export const activityInclude = {
  project: { select: { id: true, key: true, name: true } },
  task: { select: { id: true, title: true } },
  issue: { select: { id: true, code: true, title: true } },
  tag: { select: { id: true, name: true } },
  artifact: { select: { id: true, title: true, kind: true } },
  journalEntry: { select: { id: true, entryDate: true, title: true } },
  journalContribution: { select: { id: true, authorLabel: true } },
  journalCandidate: { select: { id: true, summary: true, kind: true } }
} satisfies Prisma.ActivityInclude;

export async function listActivity(
  workspaceId: string,
  filters: {
    projectId?: string; tagId?: string; actorType?: "USER" | "AI_TOOL" | "SYSTEM";
    action?: string; taskId?: string; since?: Date; limit?: number;
  }
) {
  return db.activity.findMany({
    where: {
      workspaceId,
      projectId: filters.projectId,
      OR: filters.tagId ? [
        { tagId: filters.tagId },
        { task: { tags: { some: { tagId: filters.tagId } } } }
      ] : undefined,
      actorType: filters.actorType,
      action: filters.action ? { startsWith: filters.action } : undefined,
      taskId: filters.taskId,
      createdAt: filters.since ? { gte: filters.since } : undefined
    },
    include: activityInclude,
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(filters.limit ?? 500, 1), 501)
  });
}

export function serializeActivity(event: {
  id: string; action: string; summary: string; actorType: string; actorLabel: string; createdAt: Date;
  project: { id: string; key: string; name: string } | null;
  task: { id: string; title: string } | null;
  issue: { id: string; code: string; title: string } | null;
  tag: { id: string; name: string } | null;
  artifact: { id: string; title: string; kind: string } | null;
  journalEntry: { id: string; entryDate: Date; title: string } | null;
  journalContribution: { id: string; authorLabel: string } | null;
  journalCandidate: { id: string; summary: string; kind: string } | null;
}) {
  return {
    id: event.id, action: event.action, summary: event.summary, actorType: event.actorType,
    actorLabel: event.actorLabel, createdAt: event.createdAt.toISOString(),
    project: event.project, task: event.task, issue: event.issue, tag: event.tag, artifact: event.artifact,
    journalEntry: event.journalEntry ? {
      id: event.journalEntry.id,
      date: journalDateString(event.journalEntry.entryDate),
      title: event.journalEntry.title
    } : null,
    journalContribution: event.journalContribution,
    journalCandidate: event.journalCandidate
  };
}

/** Projects and tags with archive state and task counts — the classification view. */
export async function getWorkspaceStructure(workspaceId: string, includeArchived = true) {
  const archivedFilter = includeArchived ? undefined : null;
  const [projects, tags] = await Promise.all([
    db.project.findMany({
      where: { workspaceId, archivedAt: archivedFilter }, include: { _count: { select: { tasks: true } } },
      orderBy: [{ archivedAt: "asc" }, { name: "asc" }]
    }),
    db.tag.findMany({
      where: { workspaceId, archivedAt: archivedFilter }, include: { _count: { select: { tasks: true } } },
      orderBy: [{ archivedAt: "asc" }, { name: "asc" }]
    })
  ]);
  return {
    projects: projects.map((project) => ({
      id: project.id, key: project.key, name: project.name, description: project.description,
      status: project.status, color: project.color, archivedAt: project.archivedAt?.toISOString() ?? null,
      taskCount: project._count.tasks
    })),
    tags: tags.map((tag) => ({
      id: tag.id, name: tag.name, color: tag.color, archivedAt: tag.archivedAt?.toISOString() ?? null,
      taskCount: tag._count.tasks
    })),
    includeArchived
  };
}
