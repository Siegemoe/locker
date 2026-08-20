import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { db } from "../lib/db";
import {
  approveTask, archiveTask, createTask, listTasks, replaceTaskDependencies, restoreTask,
  submitTaskCompletion, updateTask
} from "../lib/task-service";
import { createArtifact, listActivity } from "../lib/workspace-service";
import {
  finalizeJournalEntry, flagJournalCandidate, getAgentReflections, getJournalEntry,
  journalDateString, renderJournalMarkdown, searchJournal, upsertJournalContribution,
  type JournalEntryWithContext
} from "../lib/journal-service";

const CARD_URI = "ui://spore-locker/task-context-v3.html";
const cardHtml = readFileSync(fileURLToPath(new URL("./spore-card.html", import.meta.url)), "utf8");
const aiActor = { type: "AI_TOOL" as const, label: "Spore Locker MCP" };

const statusSchema = z.enum(["BACKLOG", "READY", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELED"]);
const prioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
const journalRoleSchema = z.enum(["REFLECTION", "USER_DECISION", "AGENT_OBSERVATION", "AGENT_HYPOTHESIS", "AGENT_RECOMMENDATION", "OBJECTIVE_ACTIVITY"]);
const journalCandidateKindSchema = z.enum(["DECISION", "REALIZATION", "MILESTONE", "DIRECTION_CHANGE", "ABANDONED_ASSUMPTION", "IDEA", "DISAGREEMENT", "FAILURE", "CHANGE_OF_MIND", "COMPLETION", "EVIDENCE"]);
const tagSchema = z.object({ id: z.string(), name: z.string(), color: z.string().nullable() });
const artifactSchema = z.object({
  id: z.string(), kind: z.enum(["LINK", "TEXT", "FILE_METADATA"]), title: z.string(),
  url: z.string().nullable(), textContent: z.string().nullable(), fileName: z.string().nullable(),
  mimeType: z.string().nullable(), sizeBytes: z.number().nullable()
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
  tag: z.object({ id: z.string(), name: z.string() }).nullable(),
  artifact: z.object({ id: z.string(), title: z.string(), kind: z.string() }).nullable(),
  journalEntry: z.object({ id: z.string(), date: z.string(), title: z.string() }).nullable(),
  journalContribution: z.object({ id: z.string(), authorLabel: z.string() }).nullable(),
  journalCandidate: z.object({ id: z.string(), summary: z.string(), kind: z.string() }).nullable()
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

function serialize(task: Awaited<ReturnType<typeof listTasks>>[number]) {
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
    artifacts: task.artifacts.map((artifact) => ({
      id: artifact.id, kind: artifact.kind, title: artifact.title, url: artifact.url,
      textContent: artifact.textContent, fileName: artifact.fileName,
      mimeType: artifact.mimeType, sizeBytes: artifact.sizeBytes
    })),
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
    project: event.project, task: event.task, tag: event.tag, artifact: event.artifact,
    journalEntry: event.journalEntry ? {
      id: event.journalEntry.id,
      date: journalDateString(event.journalEntry.entryDate),
      title: event.journalEntry.title
    } : null,
    journalContribution: event.journalContribution,
    journalCandidate: event.journalCandidate
  };
}

function serializeJournalEntry(entry: JournalEntryWithContext) {
  return {
    id: entry.id,
    date: journalDateString(entry.entryDate),
    title: entry.title,
    subtitle: entry.subtitle,
    status: entry.status,
    version: entry.version,
    finalizedAt: entry.finalizedAt?.toISOString() ?? null,
    finalizedBy: entry.finalizedBy,
    contributions: entry.contributions.map((contribution) => ({
      id: contribution.id,
      authorKey: contribution.authorKey,
      authorLabel: contribution.authorLabel,
      modelId: contribution.modelId,
      role: contribution.role,
      bodyMarkdown: contribution.bodyMarkdown,
      topics: contribution.topics,
      importance: contribution.importance,
      sourceReferences: contribution.sourceReferences,
      version: contribution.version,
      projects: contribution.projects.map(({ project }) => project),
      createdAt: contribution.createdAt.toISOString(),
      updatedAt: contribution.updatedAt.toISOString()
    })),
    candidates: entry.candidates.map((candidate) => ({
      id: candidate.id,
      authorKey: candidate.authorKey,
      authorLabel: candidate.authorLabel,
      modelId: candidate.modelId,
      kind: candidate.kind,
      summary: candidate.summary,
      contextMarkdown: candidate.contextMarkdown,
      importance: candidate.importance,
      sourceReferences: candidate.sourceReferences,
      consumedAt: candidate.consumedAt?.toISOString() ?? null,
      project: candidate.project,
      createdAt: candidate.createdAt.toISOString()
    })),
    markdown: renderJournalMarkdown(entry),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString()
  };
}

function lockerToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function taskContext(taskId: string) {
  const id = await workspaceId();
  const task = await db.task.findFirstOrThrow({
    where: { id: taskId, workspaceId: id },
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
      activities: { orderBy: { createdAt: "desc" }, take: 100 }
    }
  });
  const activity = await listActivity(id, { taskId, limit: 100 });
  return { task: serialize(task), activity: activity.map(serializeActivity) };
}

async function workQueue(projectId?: string, limit = 25) {
  const tasks = (await listTasks(await workspaceId(), projectId)).map(serialize);
  const unresolved = (task: (typeof tasks)[number]) => task.dependencies.some((item) => !item.resolved);
  const priority = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
  const ranked = [...tasks].sort((a, b) =>
    priority[a.priority as keyof typeof priority] - priority[b.priority as keyof typeof priority] ||
    a.title.localeCompare(b.title)
  );
  const select = (predicate: (task: (typeof tasks)[number]) => boolean) => ranked.filter(predicate).slice(0, limit);
  const actionable = select((task) => task.actionable);
  const backlog = select((task) => task.status === "BACKLOG" && !unresolved(task));
  const blocked = select((task) =>
    !["DONE", "CANCELED"].includes(task.status) && (task.status === "BLOCKED" || unresolved(task)));
  const review = select((task) => task.status === "DONE" && !task.approvedAt);
  return {
    actionable, backlog, blocked, review,
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
  { name: "spore-locker", version: "0.6.0" },
  {
    instructions:
      "Spore Locker is a local-first planning and context workspace for autonomous software work. " +
      "Use the dependency-aware work queue to select useful work, keep task plans current, and record lifecycle decisions in the immutable activity trail. " +
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
  result(await workQueue(projectId, limit), "Loaded the dependency-aware Spore Locker work queue."));

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

registerAppTool(server, "plan_spore_task_dependencies", {
  title: "Plan Spore Locker task dependencies",
  description: "Replaces a task's dependency plan, rejects cross-workspace references and blocking cycles, and records the decision in activity history.",
  inputSchema: {
    id: z.string().uuid(), version: z.number().int().positive(),
    dependencies: z.array(z.object({
      taskId: z.string().uuid(), type: z.enum(["BLOCKS", "RELATES_TO", "DUPLICATES"])
    })).max(100)
  },
  outputSchema: taskContextSchema,
  annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ id, version, dependencies }) => {
  await replaceTaskDependencies(id, version, dependencies, aiActor);
  return result(await taskContext(id), "Updated the task dependency plan.");
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
  return result(await taskContext(id), "Recorded completion evidence. No approval was recorded.");
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
  return result(await taskContext(id), "Approved the completed Spore Locker task.");
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

registerAppTool(server, "get_spore_journal_entry", {
  title: "Read a Spore Locker Journal entry",
  description: "Reads one canonical daily Journal entry with attributed agent contributions, candidate events, provenance, and a deterministic Markdown rendering. Defaults to today in the Locker timezone.",
  inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
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
  inputSchema: {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    authorKey: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/i),
    authorLabel: z.string().trim().min(1).max(120),
    modelId: z.string().trim().max(160).nullable().optional(),
    role: journalRoleSchema.optional(),
    bodyMarkdown: z.string().trim().min(1).max(100_000),
    topics: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    importance: z.number().int().min(1).max(5).optional(),
    sourceReferences: z.array(z.string().trim().min(1).max(2_000)).max(50).optional(),
    projectIds: z.array(z.string().uuid()).max(50).optional(),
    candidateIds: z.array(z.string().uuid()).max(100).optional(),
    version: z.number().int().positive().optional()
  },
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
  inputSchema: {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    authorKey: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/i),
    authorLabel: z.string().trim().min(1).max(120),
    modelId: z.string().trim().max(160).nullable().optional(),
    kind: journalCandidateKindSchema,
    summary: z.string().trim().min(1).max(2_000),
    contextMarkdown: z.string().trim().max(20_000).nullable().optional(),
    importance: z.number().int().min(1).max(5).optional(),
    sourceReferences: z.array(z.string().trim().min(1).max(2_000)).max(50).optional(),
    projectId: z.string().uuid().nullable().optional()
  },
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
  inputSchema: {
    query: z.string().trim().min(1).max(500),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    authorKey: z.string().trim().max(80).optional(),
    topic: z.string().trim().max(80).optional(),
    projectId: z.string().uuid().optional(),
    minImportance: z.number().int().min(1).max(5).optional(),
    limit: z.number().int().min(1).max(100).optional()
  },
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
    before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.number().int().min(1).max(100).optional()
  },
  outputSchema: { reflections: z.array(journalReflectionSchema) },
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  _meta: { ui: { visibility: ["model"] } }
}, async ({ authorKey, before, limit }) => {
  const contributions = await getAgentReflections(await workspaceId(), authorKey, { before, limit });
  const reflections = contributions.map((contribution) => ({
    id: contribution.id,
    authorKey: contribution.authorKey,
    authorLabel: contribution.authorLabel,
    modelId: contribution.modelId,
    role: contribution.role,
    bodyMarkdown: contribution.bodyMarkdown,
    topics: contribution.topics,
    importance: contribution.importance,
    sourceReferences: contribution.sourceReferences,
    version: contribution.version,
    projects: contribution.projects.map(({ project }) => project),
    createdAt: contribution.createdAt.toISOString(),
    updatedAt: contribution.updatedAt.toISOString(),
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
