import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  ActivityActorType, ArtifactKind, IssueCloseReason, IssueKind, IssueSeverity, IssueStatus, TaskStatus
} from "@prisma/client";
import { db } from "../lib/db";
import {
  artifactFileNameSchema, artifactMimeTypeSchema, artifactSizeBytesSchema, artifactTitleSchema, artifactUrlSchema
} from "../lib/artifact-schema";
import {
  journalCandidateInputSchema, journalContributionInputSchema, journalDateSchema, journalSearchInputSchema
} from "../lib/journal-schema";
import {
  issueAssignInputSchema, issueAssignSchema, issueCreateInputSchema, issueFilterInputSchema,
  issueResolvePayloadSchema, issueReopenPayloadSchema, issueUpdateInputSchema
} from "../lib/issue-schema";
import { taskCaptureInputSchema, taskDependencyPlanInputSchema, taskUpdateInputSchema } from "../lib/task-schema";
import {
  approveTask, archiveTask, createTask, getBoard, getTaskContext, getWorkQueue,
  replaceTaskDependencies, restoreTask, submitTaskCompletion, updateTask
} from "../lib/task-service";
import { createArtifact, getWorkspaceStructure, listActivity, serializeActivity } from "../lib/workspace-service";
import {
  assignIssue, createIssue, issueContext, issueLifecycle, listIssues, serializeIssue, updateIssue
} from "../lib/issue-service";
import {
  finalizeJournalEntry, flagJournalCandidate, getAgentReflections, getJournalEntry,
  journalDateString, searchJournal, serializeJournalContribution, serializeJournalEntry,
  upsertJournalContribution
} from "../lib/journal-service";

const CARD_URI = "ui://spore-locker/task-context-v3.html";
const cardHtml = readFileSync(fileURLToPath(new URL("./spore-card.html", import.meta.url)), "utf8");
const aiActor = { type: "AI_TOOL" as const, label: "Spore Locker MCP" };

const tagSchema = z.object({ id: z.string(), name: z.string(), color: z.string().nullable() });
const artifactSchema = z.object({
  id: z.string(), kind: z.enum(["LINK", "TEXT", "FILE_METADATA"]), title: z.string(),
  url: z.string().nullable(), textContent: z.string().nullable(), fileName: z.string().nullable(),
  mimeType: z.string().nullable(), sizeBytes: z.number().nullable()
});
const issueRefSchema = z.object({
  code: z.string(), title: z.string(), status: z.enum(IssueStatus), severity: z.enum(IssueSeverity)
});
const issueSchema = z.object({
  id: z.string(), code: z.string(), kind: z.enum(IssueKind), title: z.string(),
  details: z.string().nullable(), status: z.enum(IssueStatus), severity: z.enum(IssueSeverity),
  closeReason: z.enum(IssueCloseReason).nullable(),
  project: z.object({ id: z.string(), key: z.string(), name: z.string() }),
  assignedTaskId: z.string().nullable(),
  assignedTask: z.object({ id: z.string(), title: z.string(), status: z.string() }).nullable(),
  duplicateOfId: z.string().nullable(),
  duplicateOf: z.object({ id: z.string(), code: z.string(), title: z.string() }).nullable(),
  reportedBy: z.string().nullable(), version: z.number(),
  resolvedAt: z.string().nullable(), closedAt: z.string().nullable(),
  createdAt: z.string(), updatedAt: z.string(),
  artifacts: z.array(artifactSchema)
});
const relatedTaskSchema = z.object({
  id: z.string(), title: z.string(), status: z.string(), archivedAt: z.string().nullable()
});
const dependencySchema = z.object({
  type: z.enum(["BLOCKS", "RELATES_TO", "DUPLICATES"]), task: relatedTaskSchema, resolved: z.boolean()
});
const taskSchema = z.object({
  id: z.string(), title: z.string(), description: z.string().nullable(),
  status: z.string(), priority: z.string(), version: z.number(),
  completedAt: z.string().nullable(), approvedAt: z.string().nullable(),
  approvedBy: z.string().nullable(), archivedAt: z.string().nullable(),
  projectKey: z.string().nullable(), projectId: z.string().nullable(),
  tags: z.array(tagSchema), artifacts: z.array(artifactSchema),
  assignedIssues: z.array(issueRefSchema),
  dependencies: z.array(dependencySchema), dependents: z.array(dependencySchema), actionable: z.boolean()
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
  issue: z.object({ id: z.string(), code: z.string(), title: z.string() }).nullable(),
  tag: z.object({ id: z.string(), name: z.string() }).nullable(),
  artifact: z.object({ id: z.string(), title: z.string(), kind: z.string() }).nullable(),
  journalEntry: z.object({ id: z.string(), date: z.string(), title: z.string() }).nullable(),
  journalContribution: z.object({ id: z.string(), authorLabel: z.string() }).nullable(),
  journalCandidate: z.object({ id: z.string(), summary: z.string(), kind: z.string() }).nullable()
});
const taskContextSchema = { task: taskSchema, activity: z.array(activitySchema) };
const issueContextSchema = { issue: issueSchema, activity: z.array(activitySchema) };
const issueListSchema = { issues: z.array(issueSchema) };
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
const workQueueSchema = {
  actionable: z.array(taskSchema), backlog: z.array(taskSchema), blocked: z.array(taskSchema),
  review: z.array(taskSchema), counts: z.object({
    actionable: z.number(), backlog: z.number(), blocked: z.number(), review: z.number(), total: z.number()
  })
};
const journalProjectSchema = z.object({ id: z.string(), key: z.string(), name: z.string() });
const journalContributionSchema = z.object({
  id: z.string(), authorKey: z.string(), authorLabel: z.string(), modelId: z.string().nullable(),
  role: z.string(), bodyMarkdown: z.string(), topics: z.array(z.string()), importance: z.number(),
  sourceReferences: z.json().nullable(), version: z.number(), projects: z.array(journalProjectSchema),
  createdAt: z.string(), updatedAt: z.string()
});
const journalCandidateSchema = z.object({
  id: z.string(), authorKey: z.string(), authorLabel: z.string(), modelId: z.string().nullable(),
  kind: z.string(), summary: z.string(), contextMarkdown: z.string().nullable(), importance: z.number(),
  sourceReferences: z.json().nullable(), consumedAt: z.string().nullable(), project: journalProjectSchema.nullable(),
  createdAt: z.string()
});
const journalEntrySchema = z.object({
  id: z.string(), date: z.string(), title: z.string(), subtitle: z.string().nullable(),
  status: z.string(), version: z.number(), finalizedAt: z.string().nullable(), finalizedBy: z.string().nullable(),
  contributions: z.array(journalContributionSchema), candidates: z.array(journalCandidateSchema),
  markdown: z.string(), createdAt: z.string(), updatedAt: z.string()
});
const journalSearchSchema = z.object({
  kind: z.enum(["CONTRIBUTION", "CANDIDATE"]), passageId: z.string(), entryId: z.string(),
  date: z.string(), entryTitle: z.string(), authorKey: z.string(), authorLabel: z.string(),
  modelId: z.string().nullable(), role: z.string(), passage: z.string(), importance: z.number(),
  topics: z.array(z.string()), projectKeys: z.array(z.string()), rank: z.number()
});
const journalReflectionSchema = journalContributionSchema.extend({
  entry: z.object({ id: z.string(), date: z.string(), title: z.string(), status: z.string() })
});

async function workspaceId() {
  return (await db.workspace.findUniqueOrThrow({ where: { slug: "spore-locker" } })).id;
}

function result<T extends object>(data: T, text: string) {
  return { structuredContent: data, content: [{ type: "text" as const, text }] };
}

async function issueResult(workspaceId: string, issueId: string) {
  const context = await issueContext(workspaceId, issueId);
  return { issue: serializeIssue(context), activity: context.activities.map(serializeActivity) };
}

function lockerToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function createSporeServer() {
const server = new McpServer(
  { name: "spore-locker", version: "0.6.0" },
  {
    instructions:
      "Spore Locker is a local-first planning and context workspace for autonomous software work. " +
      "Use the dependency-aware work queue to select useful work, keep task plans current, and record lifecycle decisions in the immutable activity trail. " +
      "Use Issues to record known problems that are not committed work yet: file work-orders against a project, assign them to tasks (which moves them IN TRIAGE), and resolve with evidence notes. Tasks cannot complete while attached issues are OPEN or IN TRIAGE, so resolve attached issues before submitting completion. " +
      "Use the Journal to preserve attributed experience and interpretation across agents without turning it into a transcript log. " +
      "The AI may complete, approve, archive, and restore tasks when the evidence supports the decision; use optimistic versions and preserve completion handoffs. " +
      "The MCP endpoint is currently local and unauthenticated, so do not expose it publicly without per-request authentication."
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
}, async () => result(await getBoard(await workspaceId()), "Opened the current Spore Locker board."));

registerAppTool(server, "list_spore_tasks", {
  title: "List Spore Locker tasks",
  description: "Lists and searches active or archived tasks, optionally filtered by project, stage, or tag.",
  inputSchema: {
    archived: z.boolean().optional(), query: z.string().trim().max(200).optional(),
    projectId: z.string().uuid().optional(), status: z.enum(TaskStatus).optional(), tagId: z.string().uuid().optional()
  },
  outputSchema: boardSchema,
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model", "app"] } }
}, async (filters) => result(await getBoard(await workspaceId(), filters), `Listed ${filters.archived ? "archived" : "active"} Spore Locker tasks.`));

registerAppTool(server, "get_spore_work_queue", {
  title: "Get the Spore Locker agent work queue",
  description: "Returns priority-ranked actionable work, backlog candidates, blocked work with dependency context, and completed work awaiting a lifecycle decision.",
  inputSchema: {
    projectId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).optional()
  },
  outputSchema: workQueueSchema,
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ projectId, limit = 25 }) =>
  result(await getWorkQueue(await workspaceId(), { projectId, limit }), "Loaded the dependency-aware Spore Locker work queue."));

registerAppTool(server, "get_spore_task_context", {
  title: "Get complete Spore Locker task context",
  description: "Returns one task with its project, tags, active artifacts, and recent immutable activity history.",
  inputSchema: { taskId: z.string().uuid() },
  outputSchema: taskContextSchema,
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ taskId }) => result(await getTaskContext(await workspaceId(), taskId), "Loaded the task context and recent history."));

registerAppTool(server, "list_spore_workspace_structure", {
  title: "List Spore Locker projects and tags",
  description: "Lists projects and tags with archive state and task counts so an advisor can classify work accurately.",
  inputSchema: { includeArchived: z.boolean().optional() },
  outputSchema: structureSchema,
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ includeArchived = true }) =>
  result(await getWorkspaceStructure(await workspaceId(), includeArchived), "Listed Spore Locker projects and tags."));

registerAppTool(server, "capture_spore_task", {
  title: "Capture a Spore Locker task",
  description: "Captures a new task or idea in the user's local Spore Locker inbox.",
  inputSchema: taskCaptureInputSchema.shape,
  outputSchema: boardSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model", "app"] } }
}, async (input) => {
  await createTask({ workspaceId: await workspaceId(), ...input }, aiActor);
  return result(await getBoard(await workspaceId()), `Captured "${input.title}" in Spore Locker.`);
});

registerAppTool(server, "update_spore_task", {
  title: "Update a Spore Locker task",
  description: "Updates task details, priority, or work stage using optimistic versioning. Setting status DONE directly is reserved for the human UI; AI tools must record evidence with submit_spore_completion instead.",
  inputSchema: {
    id: z.string().uuid(), version: z.number().int().positive(),
    ...taskUpdateInputSchema.shape
  },
  outputSchema: boardSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model", "app"] } }
}, async ({ id, version, ...patch }) => {
  await updateTask(id, version, patch, aiActor);
  return result(await getBoard(await workspaceId()), "Updated the Spore Locker task.");
});

registerAppTool(server, "plan_spore_task_dependencies", {
  title: "Plan Spore Locker task dependencies",
  description: "Replaces a task's dependency plan, rejects cross-workspace references and blocking cycles, and records the decision in activity history.",
  inputSchema: {
    id: z.string().uuid(), version: z.number().int().positive(),
    ...taskDependencyPlanInputSchema.shape
  },
  outputSchema: taskContextSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ id, version, dependencies }) => {
  await replaceTaskDependencies(id, version, dependencies, aiActor);
  return result(await getTaskContext(await workspaceId(), id), "Updated the task dependency plan.");
});

registerAppTool(server, "submit_spore_completion", {
  title: "Record Spore Locker completion",
  description: "Marks a task DONE and attaches a durable completion handoff with checks and unresolved items. Approval remains a separate, explicit lifecycle decision.",
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
  return result(await getTaskContext(await workspaceId(), id), "Recorded completion evidence. No approval was recorded.");
});

registerAppTool(server, "approve_spore_task", {
  title: "Approve a completed Spore Locker task",
  description: "Approves a completed task when its handoff evidence supports closure. The actor and decision remain visible in immutable activity history.",
  inputSchema: { id: z.string().uuid(), version: z.number().int().positive() },
  outputSchema: taskContextSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model", "app"] } }
}, async ({ id, version }) => {
  await approveTask(id, version, aiActor);
  return result(await getTaskContext(await workspaceId(), id), "Approved the completed Spore Locker task.");
});

registerAppTool(server, "archive_spore_task", {
  title: "Archive an approved Spore Locker task",
  description: "Archives an approved task without deleting its data or activity history.",
  inputSchema: { id: z.string().uuid(), version: z.number().int().positive() },
  outputSchema: boardSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model", "app"] } }
}, async ({ id, version }) => {
  await archiveTask(id, version, aiActor);
  return result(await getBoard(await workspaceId()), "Archived the approved Spore Locker task.");
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
  return result(await getBoard(await workspaceId()), "Restored the Spore Locker task.");
});

registerAppTool(server, "attach_spore_context", {
  title: "Attach context to a Spore Locker task",
  description: "Attaches a safe HTTPS link, text/Markdown reference, or validated file metadata. It never uploads bytes or reads local files.",
  inputSchema: {
    taskId: z.string().uuid(),
    kind: z.enum(ArtifactKind),
    title: artifactTitleSchema,
    url: artifactUrlSchema.optional(),
    textContent: z.string().max(100_000).optional(),
    fileName: artifactFileNameSchema.optional(),
    mimeType: artifactMimeTypeSchema.optional(),
    sizeBytes: artifactSizeBytesSchema.optional()
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
  return result(await getBoard(await workspaceId()), `Attached context to the Spore Locker task.`);
});

registerAppTool(server, "attach_spore_workspace_reference", {
  title: "Attach a workspace path reference",
  description: "Attaches a portable workspace alias plus relative path as text context. It never resolves or reads the local path.",
  inputSchema: {
    taskId: z.string().uuid(), title: artifactTitleSchema,
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
  return result(await getTaskContext(await workspaceId(), taskId), "Attached the portable workspace reference without reading local files.");
});

registerAppTool(server, "file_spore_issue", {
  title: "File a Spore Locker issue",
  description: "Files a work-order issue against a project with optional metadata-only attachments. Projects name the affected system; without one the issue lands in the UNASSIGNED bucket. Filing never assigns the issue to a task.",
  inputSchema: issueCreateInputSchema.shape,
  outputSchema: issueContextSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model", "app"] } }
}, async (input) => {
  const id = await workspaceId();
  const issue = await createIssue({ workspaceId: id, ...input }, aiActor);
  return result(await issueResult(id, issue.id), `Filed issue ${issue.code}: ${issue.title}`);
});

registerAppTool(server, "list_spore_issues", {
  title: "List Spore Locker issues",
  description: "Lists and searches work-order issues with status, severity, kind, project, and assignment filters so agents can triage known problems.",
  inputSchema: issueFilterInputSchema.shape,
  outputSchema: issueListSchema,
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async (filters) => {
  const id = await workspaceId();
  const issues = await listIssues(id, filters);
  return result({ issues: issues.map(serializeIssue) }, `Listed ${issues.length} Spore Locker issues.`);
});

registerAppTool(server, "get_spore_issue_context", {
  title: "Get complete Spore Locker issue context",
  description: "Returns one work-order issue with its project, assignment, duplicate links, attachments, and recent immutable activity history.",
  inputSchema: { issueId: z.string().uuid() },
  outputSchema: issueContextSchema,
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ issueId }) =>
  result(await issueResult(await workspaceId(), issueId), "Loaded the issue context and recent history."));

registerAppTool(server, "update_spore_issue", {
  title: "Update a Spore Locker issue",
  description: "Updates an issue's title, details, kind, severity, project, or duplicate link using optimistic versioning. Status changes belong to the lifecycle tools.",
  inputSchema: {
    id: z.string().uuid(), version: z.number().int().positive(),
    ...issueUpdateInputSchema.shape
  },
  outputSchema: issueContextSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ id, version, ...patch }) => {
  await updateIssue(id, version, patch, aiActor);
  return result(await issueResult(await workspaceId(), id), "Updated the Spore Locker issue.");
});

registerAppTool(server, "assign_spore_issue", {
  title: "Assign a Spore Locker issue to a task",
  description: "Attaches an OPEN or IN TRIAGE issue to an active task in the issue's own project, or creates a new task for it in that project. Assignment moves the issue IN TRIAGE. DONE and CANCELED tasks refuse new issues.",
  inputSchema: { id: z.string().uuid(), ...issueAssignInputSchema.shape },
  outputSchema: issueContextSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ id, ...input }) => {
  // The xor rule lives on the shared contract; surface its message verbatim.
  const parsed = issueAssignSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const { version, taskId, newTask } = parsed.data;
  await assignIssue(id, version, newTask ? { newTask } : { taskId: taskId! }, aiActor);
  return result(await issueResult(await workspaceId(), id), "Assigned the issue to a task; it is now IN TRIAGE.");
});

registerAppTool(server, "resolve_spore_issue", {
  title: "Resolve a Spore Locker issue",
  description: "Resolves an OPEN or IN TRIAGE issue. FIXED requires a note describing the fix and rests at RESOLVED awaiting verification; WONT_FIX, NOT_A_BUG, and DUPLICATE (with the original issue id) close outright and cascade to open duplicates.",
  inputSchema: {
    id: z.string().uuid(), version: z.number().int().positive(),
    ...issueResolvePayloadSchema.shape
  },
  outputSchema: issueContextSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ id, version, closeReason, note, duplicateOfId }) => {
  await issueLifecycle(id, version, "resolve", { closeReason, note, duplicateOfId }, aiActor);
  return result(await issueResult(await workspaceId(), id), "Recorded the issue resolution in immutable history.");
});

registerAppTool(server, "reopen_spore_issue", {
  title: "Reopen a Spore Locker issue",
  description: "Reopens a RESOLVED or CLOSED issue with a required note explaining what came back. The assignment is cleared and the issue returns to OPEN for re-triage.",
  inputSchema: {
    id: z.string().uuid(), version: z.number().int().positive(),
    ...issueReopenPayloadSchema.shape
  },
  outputSchema: issueContextSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ id, version, note }) => {
  await issueLifecycle(id, version, "reopen", { note }, aiActor);
  return result(await issueResult(await workspaceId(), id), "Reopened the issue for re-triage.");
});

registerAppTool(server, "get_spore_journal_entry", {
  title: "Read a Spore Locker Journal entry",
  description: "Reads one canonical daily Journal entry with attributed agent contributions, candidate events, provenance, and a deterministic Markdown rendering. Defaults to today in the Locker timezone.",
  inputSchema: { date: journalDateSchema.optional() },
  outputSchema: { date: z.string(), entry: journalEntrySchema.nullable() },
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ date = lockerToday() }) => {
  const entry = await getJournalEntry(await workspaceId(), date);
  return result({ date, entry: entry ? serializeJournalEntry(entry) : null }, entry ? `Loaded the ${date} Journal.` : `No Journal entry exists for ${date}.`);
});

registerAppTool(server, "upsert_spore_journal_contribution", {
  title: "Write an attributed Journal contribution",
  description: "Creates or updates the calling agent's attributed section in a daily Journal. Updates require the current contribution version; finalized days remain immutable.",
  // The tool defaults the date to today; the contract itself requires it.
  inputSchema: journalContributionInputSchema.extend({ date: journalDateSchema.optional() }).shape,
  outputSchema: { entry: journalEntrySchema },
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ date = lockerToday(), ...input }) => {
  const entry = await upsertJournalContribution({ workspaceId: await workspaceId(), date, ...input }, aiActor);
  return result({ entry: serializeJournalEntry(entry) }, `Saved ${input.authorLabel}'s attributed Journal contribution for ${date}.`);
});

registerAppTool(server, "flag_spore_journal_candidate", {
  title: "Flag an important Journal event",
  description: "Captures a lightweight, attributed event for later daily reflection without recording the full interaction transcript.",
  inputSchema: journalCandidateInputSchema.extend({ date: journalDateSchema.optional() }).shape,
  outputSchema: { entry: journalEntrySchema },
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ date = lockerToday(), ...input }) => {
  const entry = await flagJournalCandidate({ workspaceId: await workspaceId(), date, ...input }, aiActor);
  return result({ entry: serializeJournalEntry(entry) }, `Flagged an attributed ${input.kind.toLowerCase().replaceAll("_", " ")} for the ${date} Journal.`);
});

registerAppTool(server, "search_spore_journal", {
  title: "Search the Spore Locker Journal",
  description: "Runs PostgreSQL full-text search across original Journal contributions and candidate passages with date, author, project, and importance filters.",
  inputSchema: journalSearchInputSchema.shape,
  outputSchema: { results: z.array(journalSearchSchema) },
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async (input) => {
  const matches = await searchJournal(await workspaceId(), input);
  const results = matches.map(({ entryDate, ...match }) => ({
    ...match, date: journalDateString(entryDate)
  }));
  return result({ results }, `Found ${results.length} original Journal passages.`);
});

registerAppTool(server, "get_spore_agent_reflections", {
  title: "Read an agent's earlier Journal reflections",
  description: "Returns prior attributed contributions for one stable agent identity so the agent can revisit, revise, or challenge earlier conclusions in a new dated entry.",
  inputSchema: {
    authorKey: z.string().trim().min(1).max(80),
    before: journalDateSchema.optional(),
    limit: z.number().int().min(1).max(100).optional()
  },
  outputSchema: { reflections: z.array(journalReflectionSchema) },
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ authorKey, before, limit }) => {
  const contributions = await getAgentReflections(await workspaceId(), authorKey, { before, limit });
  const reflections = contributions.map((contribution) => ({
    ...serializeJournalContribution(contribution),
    entry: {
      id: contribution.entry.id,
      date: journalDateString(contribution.entry.entryDate),
      title: contribution.entry.title,
      status: contribution.entry.status
    }
  }));
  return result({ reflections }, `Loaded ${reflections.length} prior reflections for ${authorKey}.`);
});

registerAppTool(server, "finalize_spore_journal_entry", {
  title: "Finalize a daily Journal entry",
  description: "Closes an open daily Journal entry using optimistic versioning. Finalized contributions remain immutable; later reinterpretation belongs in a new dated entry.",
  inputSchema: { id: z.string().uuid(), version: z.number().int().positive() },
  outputSchema: { entry: journalEntrySchema },
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ id, version }) => {
  const entry = await finalizeJournalEntry(id, version, aiActor);
  return result({ entry: serializeJournalEntry(entry) }, `Finalized the ${journalDateString(entry.entryDate)} Journal entry.`);
});

registerAppTool(server, "list_spore_activity", {
  title: "List Spore Locker activity",
  description: "Reads the append-only activity history with optional task, project, tag, actor, action-family, and time filters.",
  inputSchema: {
    projectId: z.string().uuid().optional(), tagId: z.string().uuid().optional(),
    actorType: z.enum(ActivityActorType).optional(),
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
