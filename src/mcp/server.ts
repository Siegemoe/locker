import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { db } from "../lib/db";
import {
  approveTask, archiveTask, createTask, listTasks, restoreTask, updateTask
} from "../lib/task-service";
import { createArtifact } from "../lib/workspace-service";

const CARD_URI = "ui://spore-locker/task-context-v3.html";
const cardHtml = readFileSync(fileURLToPath(new URL("./spore-card.html", import.meta.url)), "utf8");
const aiActor = { type: "AI_TOOL" as const, label: "Spore Locker MCP" };
const humanCardActor = { type: "USER" as const, label: "Human via Spore Locker card" };

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

async function board(archived = false) {
  const id = await workspaceId();
  const [tasks, projects, tags] = await Promise.all([
    listTasks(id, undefined, archived),
    db.project.findMany({ where: { workspaceId: id, archivedAt: null }, select: { id: true, key: true, name: true }, orderBy: { name: "asc" } }),
    db.tag.findMany({ where: { workspaceId: id, archivedAt: null }, select: { id: true, name: true, color: true }, orderBy: { name: "asc" } })
  ]);
  return { tasks: tasks.map(serialize), archived, projects, tags };
}

function result(data: Awaited<ReturnType<typeof board>>, text: string) {
  return { structuredContent: data, content: [{ type: "text" as const, text }] };
}

export function createSporeServer() {
const server = new McpServer(
  { name: "spore-locker", version: "0.3.0" },
  {
    instructions:
      "Spore Locker is the user's local shared task system. Capture and update work when asked. " +
      "Completion is not final until the human approves it in the Spore Locker card. Never claim AI approval."
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
  description: "Lists active or archived tasks from the user's local Spore Locker database.",
  inputSchema: { archived: z.boolean().optional() },
  outputSchema: boardSchema,
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model", "app"] } }
}, async ({ archived = false }) => result(await board(archived), `Listed ${archived ? "archived" : "active"} Spore Locker tasks.`));

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

registerAppTool(server, "approve_spore_task", {
  title: "Approve a completed Spore Locker task",
  description: "Records the human's explicit approval of a completed task. Available only from the interactive card.",
  inputSchema: { id: z.string().uuid(), version: z.number().int().positive() },
  outputSchema: boardSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["app"] } }
}, async ({ id, version }) => {
  await approveTask(id, version, humanCardActor);
  return result(await board(), "Human approval recorded.");
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
