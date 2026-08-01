import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { db } from "../lib/db";
import {
  archiveTask, createTask, listTasks, restoreTask, submitTaskCompletion, updateTask
} from "../lib/task-service";
import { createArtifact, listActivity } from "../lib/workspace-service";

const CARD_URI = "ui://spore-locker/task-context-v3.html";
const cardHtml = readFileSync(fileURLToPath(new URL("./spore-card.html", import.meta.url)), "utf8");
const aiActor = { type: "AI_TOOL" as const, label: "Spore Locker MCP" };

const statusSchema = z.enum(["BACKLOG", "READY", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELED"]);
const prioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
const tagSchema = z.object({ id: z.string(), name: z.string(), color: z.string().nullable() });
const artifactSchema = z.object({
  id: z.string(), kind: z.enum(["LINK", "TEXT", "FILE_METADATA"]), title: z.string(),
  url: z.string().nullable(), textContent: z.string().nullable(), fileName: z.string().nullable(),
  mimeType: z.string().nullable(), sizeBytes: z.number().nullable()
});
const taskSchema = z.object({
  id: z.string(), title: z.string(), description: z.string().nullable(),
  status: z.string(), priority: z.string(), version: z.number(),
  completedAt: z.string().nullable(), approvedAt: z.string().nullable(),
  approvedBy: z.string().nullable(), archivedAt: z.string().nullable(),
  projectKey: z.string().nullable(), projectId: z.string().nullable(),
  tags: z.array(tagSchema), artifacts: z.array(artifactSchema)
});
const boardSchema = {
  tasks: z.array(taskSchema), archived: z.boolean(),
  projects: z.array(z.object({ id: z.string(), key: z.string(), name: z.string() })),
  tags: z.array(tagSchema)
};
const activitySchema = z.object({
  id: z.string(), action: z.string(), summary: z.string(), actorType: z.string(), actorLabel: z.string(),
  createdAt: z.string(), project: z.object({ id: z.string(), key: z.string(), name: z.string() }).nullable(),
  task: z.object({ id: z.string(), title: z.string() }).nullable(),
  tag: z.object({ id: z.string(), name: z.string() }).nullable(),
  artifact: z.object({ id: z.string(), title: z.string(), kind: z.string() }).nullable()
});
const taskContextSchema = { task: taskSchema, activity: z.array(activitySchema) };
const projectStructureSchema = z.object({
  id: z.string(), key: z.string(), name: z.string(), description: z.string().nullable(),
  status: z.string(), color: z.string().nullable(), archivedAt: z.string().nullable(), taskCount: z.number()
});
const tagStructureSchema = z.object({
  id: z.string(), name: z.string(), color: z.string().nullable(),
  archivedAt: z.string().nullable(), taskCount: z.number()
});
const structureSchema = {
  projects: z.array(projectStructureSchema), tags: z.array(tagStructureSchema), includeArchived: z.boolean()
};
const activityListSchema = { activity: z.array(activitySchema), limit: z.number(), truncated: z.boolean() };

async function workspaceId() {
  return (await db.workspace.findUniqueOrThrow({ where: { slug: "spore-locker" } })).id;
}

function serialize(task: Awaited<ReturnType<typeof listTasks>>[number]) {
  return {
    id: task.id, title: task.title, description: task.description, status: task.status,
    priority: task.priority, version: task.version,
    completedAt: task.completedAt?.toISOString() ?? null,
    approvedAt: task.approvedAt?.toISOString() ?? null, approvedBy: task.approvedBy,
    archivedAt: task.archivedAt?.toISOString() ?? null,
    projectKey: task.project?.key ?? null, projectId: task.project?.id ?? null,
    tags: task.tags.map(({ tag }) => ({ id: tag.id, name: tag.name, color: tag.color })),
    artifacts: task.artifacts.map((artifact) => ({
      id: artifact.id, kind: artifact.kind, title: artifact.title, url: artifact.url,
      textContent: artifact.textContent, fileName: artifact.fileName,
      mimeType: artifact.mimeType, sizeBytes: artifact.sizeBytes
    }))
  };
}

async function board(filters: {
  archived?: boolean; query?: string; projectId?: string; status?: string; tagId?: string;
} = {}) {
  const archived = filters.archived ?? false;
  const id = await workspaceId();
  const [tasks, projects, tags] = await Promise.all([
    listTasks(id, filters.projectId, archived),
    db.project.findMany({ where: { workspaceId: id, archivedAt: null }, select: { id: true, key: true, name: true }, orderBy: { name: "asc" } }),
    db.tag.findMany({ where: { workspaceId: id, archivedAt: null }, select: { id: true, name: true, color: true }, orderBy: { name: "asc" } })
  ]);
  const query = filters.query?.trim().toLowerCase();
  const filtered = tasks.filter((task) => {
    if (filters.status && task.status !== filters.status) return false;
    if (filters.tagId && !task.tags.some(({ tag }) => tag.id === filters.tagId)) return false;
    if (!query) return true;
    return [task.title, task.description ?? "", task.project?.key ?? "", task.project?.name ?? "",
      ...task.tags.map(({ tag }) => tag.name)].join(" ").toLowerCase().includes(query);
  });
  return { tasks: filtered.map(serialize), archived, projects, tags };
}

function result<T extends object>(data: T, text: string) {
  return { structuredContent: data, content: [{ type: "text" as const, text }] };
}

function serializeActivity(event: Awaited<ReturnType<typeof listActivity>>[number]) {
  return {
    id: event.id, action: event.action, summary: event.summary, actorType: event.actorType,
    actorLabel: event.actorLabel, createdAt: event.createdAt.toISOString(),
    project: event.project, task: event.task, tag: event.tag, artifact: event.artifact
  };
}

async function taskContext(taskId: string) {
  const id = await workspaceId();
  const task = await db.task.findFirstOrThrow({
    where: { id: taskId, workspaceId: id },
    include: {
      project: { select: { id: true, key: true, name: true } },
      tags: { include: { tag: true }, orderBy: { createdAt: "asc" } },
      artifacts: { where: { archivedAt: null }, orderBy: { createdAt: "desc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 100 }
    }
  });
  const activity = await listActivity(id, { taskId, limit: 100 });
  return { task: serialize(task), activity: activity.map(serializeActivity) };
}

async function workspaceStructure(includeArchived = true) {
  const id = await workspaceId();
  const archivedFilter = includeArchived ? undefined : null;
  const [projects, tags] = await Promise.all([
    db.project.findMany({
      where: { workspaceId: id, archivedAt: archivedFilter }, include: { _count: { select: { tasks: true } } },
      orderBy: [{ archivedAt: "asc" }, { name: "asc" }]
    }),
    db.tag.findMany({
      where: { workspaceId: id, archivedAt: archivedFilter }, include: { _count: { select: { tasks: true } } },
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

export function createSporeServer() {
const server = new McpServer(
  { name: "spore-locker", version: "0.4.0" },
  {
    instructions:
      "Spore Locker is a detached advisory and information-sharing workspace, not an agent runtime or delegated authority. " +
      "Use it to capture, organize, retrieve, and hand off context when the user asks. The MCP endpoint is currently unauthenticated. " +
      "Submitting completion marks a task DONE and preserves a handoff report for human review; it never approves completion. " +
      "Only the human-facing standalone Locker may record approval. Never claim AI or MCP approval."
  }
);

registerAppResource(server, "spore-locker-card", CARD_URI, {}, async () => ({
  contents: [{
    uri: CARD_URI,
    mimeType: RESOURCE_MIME_TYPE,
    text: cardHtml,
    _meta: { ui: { prefersBorder: true } }
  }]
}));

registerAppTool(server, "open_spore_locker", {
  title: "Open Spore Locker",
  description: "Shows the current local task board as an interactive inline card.",
  inputSchema: {},
  outputSchema: boardSchema,
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: {
    ui: { resourceUri: CARD_URI },
    "openai/outputTemplate": CARD_URI,
    "openai/toolInvocation/invoking": "Opening Spore Locker…",
    "openai/toolInvocation/invoked": "Spore Locker ready"
  }
}, async () => result(await board(), "Opened the current Spore Locker board."));

registerAppTool(server, "list_spore_tasks", {
  title: "List Spore Locker tasks",
  description: "Lists and searches active or archived tasks, optionally filtered by project, stage, or tag.",
  inputSchema: {
    archived: z.boolean().optional(), query: z.string().trim().max(200).optional(),
    projectId: z.string().uuid().optional(), status: statusSchema.optional(), tagId: z.string().uuid().optional()
  },
  outputSchema: boardSchema,
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model", "app"] } }
}, async (filters) => result(await board(filters), `Listed ${filters.archived ? "archived" : "active"} Spore Locker tasks.`));

registerAppTool(server, "get_spore_task_context", {
  title: "Get complete Spore Locker task context",
  description: "Returns one task with its project, tags, active artifacts, and recent immutable activity history.",
  inputSchema: { taskId: z.string().uuid() },
  outputSchema: taskContextSchema,
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ taskId }) => result(await taskContext(taskId), "Loaded the task context and recent history."));

registerAppTool(server, "list_spore_workspace_structure", {
  title: "List Spore Locker projects and tags",
  description: "Lists projects and tags with archive state and task counts so an advisor can classify work accurately.",
  inputSchema: { includeArchived: z.boolean().optional() },
  outputSchema: structureSchema,
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ includeArchived = true }) =>
  result(await workspaceStructure(includeArchived), "Listed Spore Locker projects and tags."));

registerAppTool(server, "capture_spore_task", {
  title: "Capture a Spore Locker task",
  description: "Captures a new task or idea in the user's local Spore Locker inbox.",
  inputSchema: {
    title: z.string().trim().min(1).max(200),
    description: z.string().max(20_000).optional(),
    priority: prioritySchema.optional(),
    projectId: z.string().uuid().optional(),
    tagIds: z.array(z.string().uuid()).max(20).optional()
  },
  outputSchema: boardSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model", "app"] } }
}, async (input) => {
  await createTask({ workspaceId: await workspaceId(), ...input }, aiActor);
  return result(await board(), `Captured "${input.title}" in Spore Locker.`);
});

registerAppTool(server, "update_spore_task", {
  title: "Update a Spore Locker task",
  description: "Updates task details, priority, or work stage using optimistic versioning.",
  inputSchema: {
    id: z.string().uuid(), version: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(20_000).nullable().optional(),
    status: statusSchema.optional(), priority: prioritySchema.optional(),
    projectId: z.string().uuid().nullable().optional(),
    tagIds: z.array(z.string().uuid()).max(20).optional()
  },
  outputSchema: boardSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model", "app"] } }
}, async ({ id, version, ...patch }) => {
  await updateTask(id, version, patch, aiActor);
  return result(await board(), "Updated the Spore Locker task.");
});

registerAppTool(server, "submit_spore_completion", {
  title: "Submit Spore Locker completion for review",
  description: "Marks a task DONE and attaches a durable completion handoff with checks and unresolved items. This never records approval.",
  inputSchema: {
    id: z.string().uuid(), version: z.number().int().positive(),
    summary: z.string().trim().min(1).max(10_000),
    checks: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
    unresolved: z.array(z.string().trim().min(1).max(500)).max(20).optional()
  },
  outputSchema: taskContextSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ id, version, summary, checks, unresolved }) => {
  await submitTaskCompletion(id, version, { summary, checks, unresolved }, aiActor);
  return result(await taskContext(id), "Submitted completion evidence for human review. No approval was recorded.");
});

registerAppTool(server, "archive_spore_task", {
  title: "Archive an approved Spore Locker task",
  description: "Archives a human-approved task without deleting its data or activity history.",
  inputSchema: { id: z.string().uuid(), version: z.number().int().positive() },
  outputSchema: boardSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model", "app"] } }
}, async ({ id, version }) => {
  await archiveTask(id, version, aiActor);
  return result(await board(), "Archived the approved Spore Locker task.");
});

registerAppTool(server, "restore_spore_task", {
  title: "Restore an archived Spore Locker task",
  description: "Restores an archived task to active Spore Locker views.",
  inputSchema: { id: z.string().uuid(), version: z.number().int().positive() },
  outputSchema: boardSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model", "app"] } }
}, async ({ id, version }) => {
  await restoreTask(id, version, aiActor);
  return result(await board(), "Restored the Spore Locker task.");
});

registerAppTool(server, "attach_spore_context", {
  title: "Attach context to a Spore Locker task",
  description: "Attaches a safe HTTPS link, text/Markdown reference, or validated file metadata. It never uploads bytes or reads local files.",
  inputSchema: {
    taskId: z.string().uuid(),
    kind: z.enum(["LINK", "TEXT", "FILE_METADATA"]),
    title: z.string().trim().min(1).max(200),
    url: z.string().url().max(2_000).optional(),
    textContent: z.string().max(100_000).optional(),
    fileName: z.string().max(255).optional(),
    mimeType: z.enum(["text/plain", "text/markdown", "application/pdf", "image/png", "image/jpeg", "image/webp"]).optional(),
    sizeBytes: z.number().int().positive().max(25 * 1024 * 1024).optional()
  },
  outputSchema: boardSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model", "app"] } }
}, async (input) => {
  if (input.kind === "LINK" && (!input.url || !/^https?:\/\//i.test(input.url))) {
    throw new Error("Link context requires an HTTP(S) URL");
  }
  if (input.kind === "TEXT" && !input.textContent) throw new Error("Text context requires content");
  if (input.kind === "FILE_METADATA" && (!input.fileName || !input.mimeType || !input.sizeBytes)) {
    throw new Error("File metadata requires fileName, mimeType, and sizeBytes");
  }
  await createArtifact(input, aiActor);
  return result(await board(), `Attached context to the Spore Locker task.`);
});

registerAppTool(server, "attach_spore_workspace_reference", {
  title: "Attach a workspace path reference",
  description: "Attaches a portable workspace alias plus relative path as text context. It never resolves or reads the local path.",
  inputSchema: {
    taskId: z.string().uuid(), title: z.string().trim().min(1).max(200),
    workspace: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/),
    relativePath: z.string().trim().min(1).max(1_000),
    revision: z.string().trim().max(100).optional(), note: z.string().trim().max(5_000).optional()
  },
  outputSchema: taskContextSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ taskId, title, workspace, relativePath, revision, note }) => {
  const segments = relativePath.split(/[\\/]+/);
  if (/^(?:[A-Za-z]:|[\\/])/.test(relativePath) || segments.includes("..")) {
    throw new Error("Workspace references require a relative path without parent traversal");
  }
  const textContent = [
    `Workspace: ${workspace}`, `Path: ${relativePath.replaceAll("\\", "/")}`,
    ...(revision ? [`Revision: ${revision}`] : []), ...(note ? ["", note] : [])
  ].join("\n");
  await createArtifact({ taskId, kind: "TEXT", title, textContent }, aiActor);
  return result(await taskContext(taskId), "Attached the portable workspace reference without reading local files.");
});

registerAppTool(server, "list_spore_activity", {
  title: "List Spore Locker activity",
  description: "Reads the append-only advisory history with optional task, project, tag, actor, action-family, and time filters.",
  inputSchema: {
    projectId: z.string().uuid().optional(), tagId: z.string().uuid().optional(),
    actorType: z.enum(["USER", "AI_TOOL", "SYSTEM"]).optional(),
    action: z.string().trim().max(80).optional(), taskId: z.string().uuid().optional(),
    since: z.string().datetime().optional(), limit: z.number().int().min(1).max(500).optional()
  },
  outputSchema: activityListSchema,
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ since, limit = 100, ...filters }) => {
  const events = await listActivity(await workspaceId(), {
    ...filters, since: since ? new Date(since) : undefined, limit: limit + 1
  });
  const truncated = events.length > limit;
  const activity = events.slice(0, limit).map(serializeActivity);
  return result({ activity, limit, truncated }, `Listed ${activity.length} Spore Locker activity events.`);
});
return server;
}

async function main() {
  const transport = new StdioServerTransport();
  const server = createSporeServer();
  await server.connect(transport);
}

if (process.env.MCP_TRANSPORT !== "http") {
  main().catch((error) => {
    console.error("Spore Locker MCP server failed:", error);
    process.exit(1);
  });
}
