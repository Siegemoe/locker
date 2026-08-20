import type { ActivityActorType, DependencyType, TaskPriority, TaskStatus } from "@prisma/client";
import { db } from "@/lib/db";

export type TaskActor = { type: ActivityActorType; label: string };

export async function listTasks(workspaceId: string, projectId?: string, archived = false) {
  return db.task.findMany({
    where: { workspaceId, projectId, archivedAt: archived ? { not: null } : null },
    include: {
      project: { select: { id: true, key: true, name: true } },
      tags: { include: { tag: true }, orderBy: { createdAt: "asc" } },
      artifacts: { where: { archivedAt: null }, orderBy: { createdAt: "desc" } },
      dependencies: {
        include: { dependsOn: { select: { id: true, title: true, status: true, archivedAt: true } } },
        orderBy: { createdAt: "asc" }
      },
      dependents: {
        include: { task: { select: { id: true, title: true, status: true, archivedAt: true } } },
        orderBy: { createdAt: "asc" }
      },
      activities: { orderBy: { createdAt: "desc" }, take: 30 }
    },
    orderBy: [{ status: "asc" }, { position: "asc" }, { createdAt: "desc" }]
  });
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
    if (current.archivedAt) throw new Error("Restore this task before changing its plan");
    if (current.version !== version) throw new Error("Task changed since it was loaded");

    const unique = new Map(dependencies.map((item) => [`${item.taskId}:${item.type}`, item]));
    if (unique.size !== dependencies.length) throw new Error("Duplicate task dependencies are not allowed");
    if (dependencies.some((item) => item.taskId === id)) throw new Error("A task cannot depend on itself");

    const targetIds = [...new Set(dependencies.map((item) => item.taskId))];
    const targets = targetIds.length
      ? await tx.task.findMany({ where: { id: { in: targetIds }, workspaceId: current.workspaceId, archivedAt: null } })
      : [];
    if (targets.length !== targetIds.length) {
      throw new Error("Dependencies must reference active tasks in the same workspace");
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
      throw new Error("Blocking dependencies cannot create a cycle");
    }

    const updated = await tx.task.updateMany({
      where: { id, version, archivedAt: null },
      data: { version: { increment: 1 } }
    });
    if (updated.count !== 1) throw new Error("Task changed since it was loaded");
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
    const { tagIds, ...taskInput } = input;
    const task = await tx.task.create({
      data: {
        ...taskInput,
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
    if (current.archivedAt) throw new Error("Restore this task before editing it");
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
    if (result.count !== 1) throw new Error("Task changed since it was loaded");
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
    if (current.archivedAt) throw new Error("Restore this task before submitting completion");
    if (current.version !== version) throw new Error("Task changed since it was loaded");

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
    if (updated.count !== 1) throw new Error("Task changed since it was loaded");
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
    if (current.version !== version) throw new Error("Task changed since it was loaded");
    if (action === "approve" && (current.status !== "DONE" || current.archivedAt)) {
      throw new Error("Only a completed, active task can be approved");
    }
    if (action === "archive" && (!current.approvedAt || current.archivedAt)) {
      throw new Error("A task must be approved before it can be archived");
    }
    if (action === "restore" && !current.archivedAt) {
      throw new Error("Task is not archived");
    }

    const now = new Date();
    const task = await tx.task.update({
      where: { id },
      data:
        action === "approve"
          ? { approvedAt: now, approvedBy: actor.label, version: { increment: 1 } }
          : action === "archive"
            ? { archivedAt: now, version: { increment: 1 } }
            : { archivedAt: null, version: { increment: 1 } }
    });
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
