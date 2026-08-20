import type { ArtifactKind } from "@prisma/client";
import { db } from "@/lib/db";
import type { TaskActor } from "@/lib/task-service";

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
    const taskCount = await tx.task.count({ where: { projectId: id } });
    if (taskCount) throw new Error("Archive this project or reassign its tasks before deleting it");
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
    taskId: string; kind: ArtifactKind; title: string; url?: string; textContent?: string;
    fileName?: string; mimeType?: string; sizeBytes?: number; storageKey?: string;
  },
  actor: TaskActor
) {
  return db.$transaction(async (tx) => {
    const task = await tx.task.findUniqueOrThrow({ where: { id: input.taskId } });
    const artifact = await tx.artifact.create({
      data: { ...input, workspaceId: task.workspaceId, createdBy: actor.label }
    });
    await tx.activity.create({
      data: {
        workspaceId: task.workspaceId, projectId: task.projectId, taskId: task.id, artifactId: artifact.id,
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
    const current = await tx.artifact.findUniqueOrThrow({ where: { id }, include: { task: true } });
    if (current.archivedAt) throw new Error("Artifact is already removed from active context");
    const artifact = await tx.artifact.update({ where: { id }, data: { archivedAt: new Date() }, include: { task: true } });
    await tx.activity.create({
      data: {
        workspaceId: artifact.workspaceId, projectId: artifact.task.projectId,
        taskId: artifact.taskId, artifactId: artifact.id,
        actorType: actor.type, actorLabel: actor.label,
        action: "artifact.removed", summary: `Removed artifact from active context: ${artifact.title}`
      }
    });
    return artifact;
  });
}

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
    include: {
      project: { select: { id: true, key: true, name: true } },
      task: { select: { id: true, title: true } },
      tag: { select: { id: true, name: true } },
      artifact: { select: { id: true, title: true, kind: true } },
      journalEntry: { select: { id: true, entryDate: true, title: true } },
      journalContribution: { select: { id: true, authorLabel: true } },
      journalCandidate: { select: { id: true, summary: true, kind: true } }
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(filters.limit ?? 500, 1), 501)
  });
}
