import { Prisma, type DependencyType, type TaskPriority, type TaskStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { ExpectedError } from "@/lib/expected-error";
import type { TaskActor } from "@/lib/actor";
import { enforceCloseGate } from "@/lib/close-gate";
import { listActivity, serializeActivity, serializeArtifact } from "@/lib/workspace-service";

/** Relations required by the serialized MCP board and task-context models. */
const taskReadInclude = {
  project: { select: { id: true, key: true, name: true } },
  tags: { include: { tag: true }, orderBy: { createdAt: "asc" } },
  artifacts: { where: { archivedAt: null }, orderBy: { createdAt: "desc" } },
  assignedIssues: { orderBy: { createdAt: "asc" } },
  dependencies: {
    include: { dependsOn: { select: { id: true, title: true, status: true, archivedAt: true } } },
    orderBy: { createdAt: "asc" }
  },
  dependents: {
    include: { task: { select: { id: true, title: true, status: true, archivedAt: true } } },
    orderBy: { createdAt: "asc" }
  }
} satisfies Prisma.TaskInclude;

/** The interactive HTTP client additionally renders each task's recent history. */
const taskListInclude = {
  ...taskReadInclude,
  activities: { orderBy: { createdAt: "desc" }, take: 30 }
} satisfies Prisma.TaskInclude;

export type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof taskReadInclude }>;

async function listTaskReadModels(workspaceId: string, projectId?: string, archived = false) {
  return db.task.findMany({
    where: { workspaceId, projectId, archivedAt: archived ? { not: null } : null },
    include: taskReadInclude,
    orderBy: [{ status: "asc" }, { position: "asc" }, { createdAt: "desc" }]
  });
}

/** Raw task rows for the interactive HTTP client, including recent activity. */
export async function listTasks(workspaceId: string, projectId?: string, archived = false) {
  return db.task.findMany({
    where: { workspaceId, projectId, archivedAt: archived ? { not: null } : null },
    include: taskListInclude,
    orderBy: [{ status: "asc" }, { position: "asc" }, { createdAt: "desc" }]
  });
}

/**
 * The wire-ready task shape: Dates as ISO strings, dependency resolution and
 * the actionable flag computed here so every adapter agrees on them.
 */
export function serializeTask(task: TaskWithRelations) {
  const dependencyResolved = (type: string, status: string) =>
    type !== "BLOCKS" || status === "DONE" || status === "CANCELED";
  const dependencies = task.dependencies.map(({ type, dependsOn }) => ({
    type, task: {
      id: dependsOn.id, title: dependsOn.title, status: dependsOn.status,
      archivedAt: dependsOn.archivedAt?.toISOString() ?? null
    },
    resolved: dependencyResolved(type, dependsOn.status)
  }));
  return {
    id: task.id, title: task.title, description: task.description, status: task.status,
    priority: task.priority, version: task.version,
    completedAt: task.completedAt?.toISOString() ?? null,
    approvedAt: task.approvedAt?.toISOString() ?? null, approvedBy: task.approvedBy,
    archivedAt: task.archivedAt?.toISOString() ?? null,
    projectKey: task.project?.key ?? null, projectId: task.project?.id ?? null,
    tags: task.tags.map(({ tag }) => ({ id: tag.id, name: tag.name, color: tag.color })),
    artifacts: task.artifacts.map(serializeArtifact),
    assignedIssues: task.assignedIssues.map(({ code, title, status, severity }) => ({ code, title, status, severity })),
    dependencies,
    dependents: task.dependents.map(({ type, task: dependent }) => ({
      type, task: {
        id: dependent.id, title: dependent.title, status: dependent.status,
        archivedAt: dependent.archivedAt?.toISOString() ?? null
      },
      resolved: dependencyResolved(type, task.status)
    })),
    actionable: ["READY", "IN_PROGRESS"].includes(task.status) && dependencies.every((item) => item.resolved)
  };
}

export async function getTaskContext(workspaceId: string, taskId: string) {
  const [task, activity] = await Promise.all([
    db.task.findFirstOrThrow({ where: { id: taskId, workspaceId }, include: taskReadInclude }),
    listActivity(workspaceId, { taskId, limit: 100 })
  ]);
  return { task: serializeTask(task), activity: activity.map(serializeActivity) };
}

/** The board read: tasks plus the project and tag dimensions used to filter them. */
export async function getBoard(
  workspaceId: string,
  filters: { archived?: boolean; query?: string; projectId?: string; status?: string; tagId?: string } = {}
) {
  const archived = filters.archived ?? false;
  const [tasks, projects, tags] = await Promise.all([
    listTaskReadModels(workspaceId, filters.projectId, archived),
    db.project.findMany({ where: { workspaceId, archivedAt: null }, select: { id: true, key: true, name: true }, orderBy: { name: "asc" } }),
    db.tag.findMany({ where: { workspaceId, archivedAt: null }, select: { id: true, name: true, color: true }, orderBy: { name: "asc" } })
  ]);
  const query = filters.query?.trim().toLowerCase();
  const filtered = tasks.filter((task) => {
    if (filters.status && task.status !== filters.status) return false;
    if (filters.tagId && !task.tags.some(({ tag }) => tag.id === filters.tagId)) return false;
    if (!query) return true;
    return [task.title, task.description ?? "", task.project?.key ?? "", task.project?.name ?? "",
      ...task.tags.map(({ tag }) => tag.name)].join(" ").toLowerCase().includes(query);
  });
  return { tasks: filtered.map(serializeTask), archived, projects, tags };
}

/** The dependency-aware work queue: priority-ranked slices with honest counts over the full set. */
export async function getWorkQueue(workspaceId: string, options: { projectId?: string; limit?: number } = {}) {
  const limit = options.limit ?? 25;
  const tasks = (await listTaskReadModels(workspaceId, options.projectId)).map(serializeTask);
  const unresolved = (task: ReturnType<typeof serializeTask>) =>
    task.dependencies.some((item) => !item.resolved);
  const priority = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
  const ranked = [...tasks].sort((a, b) =>
    priority[a.priority as keyof typeof priority] - priority[b.priority as keyof typeof priority] ||
    a.title.localeCompare(b.title)
  );
  const select = (predicate: (task: ReturnType<typeof serializeTask>) => boolean) =>
    ranked.filter(predicate).slice(0, limit);
  return {
    actionable: select((task) => task.actionable),
    backlog: select((task) => task.status === "BACKLOG" && !unresolved(task)),
    blocked: select((task) =>
      !["DONE", "CANCELED"].includes(task.status) && (task.status === "BLOCKED" || unresolved(task))),
    review: select((task) => task.status === "DONE" && !task.approvedAt),
    counts: {
      actionable: tasks.filter((task) => task.actionable).length,
      backlog: tasks.filter((task) => task.status === "BACKLOG" && !unresolved(task)).length,
      blocked: tasks.filter((task) =>
        !["DONE", "CANCELED"].includes(task.status) && (task.status === "BLOCKED" || unresolved(task))).length,
      review: tasks.filter((task) => task.status === "DONE" && !task.approvedAt).length,
      total: tasks.length
    }
  };
}

export async function replaceTaskDependencies(
  id: string,
  version: number,
  dependencies: { taskId: string; type: DependencyType }[],
  actor: TaskActor
) {
  return db.$transaction(async (tx) => {
    const current = await tx.task.findUniqueOrThrow({
      where: { id },
      include: { dependencies: { orderBy: { createdAt: "asc" } } }
    });
    if (current.archivedAt) throw new ExpectedError("Restore this task before changing its plan");
    if (current.version !== version) throw new ExpectedError("Task changed since it was loaded");

    const unique = new Map(dependencies.map((item) => [`${item.taskId}:${item.type}`, item]));
    if (unique.size !== dependencies.length) throw new ExpectedError("Duplicate task dependencies are not allowed");
    if (dependencies.some((item) => item.taskId === id)) throw new ExpectedError("A task cannot depend on itself");

    const targetIds = [...new Set(dependencies.map((item) => item.taskId))];
    const targets = targetIds.length
      ? await tx.task.findMany({ where: { id: { in: targetIds }, workspaceId: current.workspaceId, archivedAt: null } })
      : [];
    if (targets.length !== targetIds.length) {
      throw new ExpectedError("Dependencies must reference active tasks in the same workspace");
    }

    const blockingEdges = await tx.taskDependency.findMany({
      where: { type: "BLOCKS", task: { workspaceId: current.workspaceId }, taskId: { not: id } },
      select: { taskId: true, dependsOnId: true }
    });
    const adjacency = new Map<string, string[]>();
    for (const edge of blockingEdges) {
      adjacency.set(edge.taskId, [...(adjacency.get(edge.taskId) ?? []), edge.dependsOnId]);
    }
    for (const dependency of dependencies.filter((item) => item.type === "BLOCKS")) {
      adjacency.set(id, [...(adjacency.get(id) ?? []), dependency.taskId]);
    }
    const reachesTask = (start: string) => {
      const pending = [start];
      const visited = new Set<string>();
      while (pending.length) {
        const taskId = pending.pop()!;
        if (taskId === id) return true;
        if (visited.has(taskId)) continue;
        visited.add(taskId);
        pending.push(...(adjacency.get(taskId) ?? []));
      }
      return false;
    };
    if (dependencies.some((item) => item.type === "BLOCKS" && reachesTask(item.taskId))) {
      throw new ExpectedError("Blocking dependencies cannot create a cycle");
    }

    const updated = await tx.task.updateMany({
      where: { id, version, archivedAt: null },
      data: { version: { increment: 1 } }
    });
    if (updated.count !== 1) throw new ExpectedError("Task changed since it was loaded");
    await tx.taskDependency.deleteMany({ where: { taskId: id } });
    if (dependencies.length) {
      await tx.taskDependency.createMany({
        data: dependencies.map((item) => ({ taskId: id, dependsOnId: item.taskId, type: item.type }))
      });
    }
    const task = await tx.task.findUniqueOrThrow({ where: { id } });
    await tx.activity.create({
      data: {
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        actorType: actor.type,
        actorLabel: actor.label,
        action: "task.dependencies_replaced",
        summary: `Updated dependency plan: ${task.title}`,
        metadata: { before: current.dependencies, dependencies, version: task.version }
      }
    });
    return task;
  });
}

export async function createTask(
  input: {
    workspaceId: string;
    projectId?: string;
    title: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    tagIds?: string[];
  },
  actor: TaskActor
) {
  return db.$transaction(async (tx) => {
    if (input.status === "DONE" && actor.type !== "USER") {
      throw new ExpectedError("AI tools must record a completion handoff instead of creating tasks as DONE");
    }
    const { tagIds, ...taskInput } = input;
    const task = await tx.task.create({
      data: {
        ...taskInput,
        completedAt: input.status === "DONE" ? new Date() : undefined,
        createdBy: actor.label,
        tags: tagIds?.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined
      }
    });
    await tx.activity.create({
      data: {
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        actorType: actor.type,
        actorLabel: actor.label,
        action: "task.created",
        summary: `Created task: ${task.title}`
      }
    });
    return task;
  });
}

export async function updateTask(
  id: string,
  version: number,
  patch: {
    title?: string;
    description?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    projectId?: string | null;
    tagIds?: string[];
  },
  actor: TaskActor
) {
  return db.$transaction(async (tx) => {
    const current = await tx.task.findUniqueOrThrow({
      where: { id },
      include: { tags: { select: { tagId: true } } }
    });
    if (current.archivedAt) throw new ExpectedError("Restore this task before editing it");
    if (patch.status === "DONE" && actor.type !== "USER") {
      throw new ExpectedError("AI tools must record a completion handoff instead of marking tasks DONE directly");
    }
    if (patch.status === "DONE") {
      await enforceCloseGate(tx, id);
    }
    const { tagIds, ...taskPatch } = patch;
    const result = await tx.task.updateMany({
      where: { id, version, archivedAt: null },
      data: {
        ...taskPatch,
        version: { increment: 1 },
        completedAt:
          patch.status === "DONE"
            ? new Date()
            : patch.status
              ? null
              : current.completedAt
        ,
        approvedAt: patch.status && patch.status !== "DONE" ? null : current.approvedAt,
        approvedBy: patch.status && patch.status !== "DONE" ? null : current.approvedBy
      }
    });
    if (result.count !== 1) throw new ExpectedError("Task changed since it was loaded");
    if (tagIds) {
      await tx.taskTag.deleteMany({ where: { taskId: id } });
      if (tagIds.length) {
        await tx.taskTag.createMany({ data: tagIds.map((tagId) => ({ taskId: id, tagId })) });
      }
    }
    const task = await tx.task.findUniqueOrThrow({ where: { id } });
    await tx.activity.create({
      data: {
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        actorType: actor.type,
        actorLabel: actor.label,
        action: "task.updated",
        summary: `Updated task: ${task.title}`,
        metadata: { before: current, changes: patch, version: task.version }
      }
    });
    return task;
  });
}

export async function submitTaskCompletion(
  id: string,
  version: number,
  input: { summary: string; checks?: string[]; unresolved?: string[] },
  actor: TaskActor
) {
  return db.$transaction(async (tx) => {
    const current = await tx.task.findUniqueOrThrow({ where: { id } });
    if (current.archivedAt) throw new ExpectedError("Restore this task before submitting completion");
    if (current.version !== version) throw new ExpectedError("Task changed since it was loaded");
    await enforceCloseGate(tx, id);

    const checks = input.checks ?? [];
    const unresolved = input.unresolved ?? [];
    const report = [
      "# Completion handoff",
      "",
      input.summary.trim(),
      ...(checks.length ? ["", "## Checks performed", ...checks.map((item) => `- ${item.trim()}`)] : []),
      ...(unresolved.length ? ["", "## Unresolved or follow-up", ...unresolved.map((item) => `- ${item.trim()}`)] : [])
    ].join("\n");
    const updated = await tx.task.updateMany({
      where: { id, version, archivedAt: null },
      data: {
        status: "DONE", completedAt: new Date(), approvedAt: null, approvedBy: null,
        version: { increment: 1 }
      }
    });
    if (updated.count !== 1) throw new ExpectedError("Task changed since it was loaded");
    const task = await tx.task.findUniqueOrThrow({ where: { id } });
    const artifact = await tx.artifact.create({
      data: {
        workspaceId: task.workspaceId, taskId: task.id, kind: "TEXT",
        title: "Completion handoff", textContent: report, createdBy: actor.label
      }
    });
    await tx.activity.create({
      data: {
        workspaceId: task.workspaceId, projectId: task.projectId, taskId: task.id,
        artifactId: artifact.id, actorType: actor.type, actorLabel: actor.label,
        action: "task.completion_submitted",
        summary: `Recorded completion evidence: ${task.title}`,
        metadata: { summary: input.summary, checks, unresolved, artifactId: artifact.id, version: task.version }
      }
    });
    return task;
  });
}

async function lifecycleEvent(
  id: string,
  version: number,
  action: "approve" | "archive" | "restore",
  actor: TaskActor
) {
  return db.$transaction(async (tx) => {
    const current = await tx.task.findUniqueOrThrow({ where: { id } });
    if (current.version !== version) throw new ExpectedError("Task changed since it was loaded");
    if (action === "approve" && (current.status !== "DONE" || !current.completedAt || current.archivedAt)) {
      throw new ExpectedError("Only a completed, active task can be approved");
    }
    if (action === "archive" && (!current.approvedAt || current.archivedAt)) {
      throw new ExpectedError("A task must be approved before it can be archived");
    }
    if (action === "restore" && !current.archivedAt) {
      throw new ExpectedError("Task is not archived");
    }
    if (action === "approve") {
      await enforceCloseGate(tx, id);
    }

    const now = new Date();
    const result = await tx.task.updateMany({
      where: { id, version },
      data:
        action === "approve"
          ? { approvedAt: now, approvedBy: actor.label, version: { increment: 1 } }
          : action === "archive"
            ? { archivedAt: now, version: { increment: 1 } }
            : { archivedAt: null, version: { increment: 1 } }
    });
    if (result.count !== 1) throw new ExpectedError("Task changed since it was loaded");
    const task = await tx.task.findUniqueOrThrow({ where: { id } });
    const event = action === "approve" ? "approved" : action === "archive" ? "archived" : "restored";
    await tx.activity.create({
      data: {
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        actorType: actor.type,
        actorLabel: actor.label,
        action: `task.${event}`,
        summary: `${event[0].toUpperCase()}${event.slice(1)} task: ${task.title}`,
        metadata: { previousVersion: current.version, version: task.version }
      }
    });
    return task;
  });
}

export const approveTask = (id: string, version: number, actor: TaskActor) =>
  lifecycleEvent(id, version, "approve", actor);
export const archiveTask = (id: string, version: number, actor: TaskActor) =>
  lifecycleEvent(id, version, "archive", actor);
export const restoreTask = (id: string, version: number, actor: TaskActor) =>
  lifecycleEvent(id, version, "restore", actor);
