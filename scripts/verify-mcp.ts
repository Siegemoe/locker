import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { db } from "../src/lib/db";

type Task = {
  id: string; title: string; status: string; version: number; approvedAt: string | null; actionable: boolean;
  tags: { id: string; name: string }[]; artifacts: { id: string; kind: string; title: string }[];
  dependencies: { type: string; resolved: boolean; task: { id: string; status: string } }[]
};
type Board = { tasks: Task[]; archived: boolean; tags: { id: string; name: string }[] };
type Activity = { action: string; actorType: string; task: { id: string; title: string } | null };
type TaskContext = { task: Task; activity: Activity[] };
type Structure = { projects: { id: string; archivedAt: string | null; taskCount: number }[]; tags: { id: string; archivedAt: string | null; taskCount: number }[] };
type ActivityList = { activity: Activity[]; limit: number; truncated: boolean };
type WorkQueue = { actionable: Task[]; blocked: Task[]; counts: { actionable: number; blocked: number } };

const tsxCli = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
const serverFile = fileURLToPath(new URL("../src/mcp/server.ts", import.meta.url));
const childEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] =>
    typeof entry[1] === "string" && entry[0] !== "MCP_TRANSPORT")
);
const transport = process.env.MCP_URL
  ? new StreamableHTTPClientTransport(new URL(process.env.MCP_URL))
  : new StdioClientTransport({
      command: process.execPath,
      args: [tsxCli, ...(existsSync(".env") ? ["--env-file=.env"] : []), serverFile],
      cwd: process.cwd(),
      env: childEnvironment,
      stderr: "pipe"
    });
const client = new Client({ name: "spore-locker-verifier", version: "0.1.0" });
const verificationTaskIds = new Set<string>();

async function call<T>(name: string, args: Record<string, unknown> = {}) {
  const response = await client.callTool({ name, arguments: args });
  assert(!response.isError, JSON.stringify(response));
  return response.structuredContent as T;
}

async function callError(name: string, args: Record<string, unknown>) {
  const response = await client.callTool({ name, arguments: args });
  assert(response.isError, `Expected ${name} to fail`);
  return JSON.stringify(response);
}

async function main() {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = new Set(tools.tools.map((tool) => tool.name));
  for (const name of [
    "open_spore_locker", "get_spore_task_context", "list_spore_workspace_structure",
    "get_spore_work_queue", "plan_spore_task_dependencies", "submit_spore_completion",
    "approve_spore_task", "attach_spore_workspace_reference", "list_spore_activity",
    "get_spore_journal_entry", "upsert_spore_journal_contribution", "flag_spore_journal_candidate",
    "search_spore_journal", "get_spore_agent_reflections", "finalize_spore_journal_entry"
  ]) assert(names.has(name), `Missing MCP tool: ${name}`);

  const resources = await client.listResources();
  const card = resources.resources.find((resource) => resource.uri === "ui://spore-locker/task-context-v3.html");
  assert(card);
  const resource = await client.readResource({ uri: card.uri });
  const html = resource.contents[0];
  assert("text" in html && html.text.includes('request("ui/initialize"'));
  assert("text" in html && html.text.includes('request("tools/call"'));
  assert("text" in html && html.text.includes("Group: Status"));
  assert("text" in html && html.text.includes("All tags"));
  assert("text" in html && html.text.includes('id="refresh"'));
  assert("text" in html && html.text.includes('id="reset"'));
  assert("text" in html && html.text.includes('a.rel="noopener noreferrer"'));
  assert("text" in html && html.text.includes('class="layout"'));
  assert("text" in html && html.text.includes("Awaiting lifecycle decision"));
  assert("text" in html && html.text.includes("approve_spore_task"));

  const initial = await call<Board>("open_spore_locker");
  assert.equal(initial.archived, false);
  const structure = await call<Structure>("list_spore_workspace_structure", { includeArchived: true });
  assert(structure.projects.every((item) => typeof item.taskCount === "number"));
  assert(structure.tags.every((item) => typeof item.taskCount === "number"));
  const recent = await call<ActivityList>("list_spore_activity", { limit: 5 });
  assert.equal(recent.limit, 5);

  if (process.env.MCP_URL) {
    console.log(`Remote MCP verified without mutation: ${tools.tools.length} tools, card resource, structure, and activity.`);
    return;
  }

  const tag = initial.tags[0];
  const prerequisiteBoard = await call<Board>("capture_spore_task", {
    title: "MCP dependency verification prerequisite", priority: "HIGH"
  });
  const prerequisite = prerequisiteBoard.tasks.find((item) => item.title === "MCP dependency verification prerequisite");
  assert(prerequisite);
  verificationTaskIds.add(prerequisite.id);
  let board = await call<Board>("capture_spore_task", { title: "MCP advisory verification item", priority: "HIGH", tagIds: tag ? [tag.id] : [] });
  let task = board.tasks.find((item) => item.title === "MCP advisory verification item");
  assert(task);
  verificationTaskIds.add(task.id);
  if (tag) assert(task.tags.some((item) => item.id === tag.id));
  board = await call<Board>("update_spore_task", { id: task.id, version: task.version, status: "READY" });
  task = board.tasks.find((item) => item.id === task!.id);
  assert(task);
  board = await call<Board>("attach_spore_context", { taskId: task.id, kind: "LINK", title: "Verification context", url: "https://excalidraw.com/" });
  task = board.tasks.find((item) => item.id === task!.id);
  assert(task);
  assert(task.artifacts.some((artifact) => artifact.title === "Verification context"));

  let context = await call<TaskContext>("attach_spore_workspace_reference", {
    taskId: task.id, title: "Implementation plan", workspace: "spore-locker",
    relativePath: "docs/plans/advisory-mcp.md", revision: "main", note: "Portable reference only"
  });
  assert(context.task.artifacts.some((artifact) => artifact.title === "Implementation plan" && artifact.kind === "TEXT"));

  context = await call<TaskContext>("plan_spore_task_dependencies", {
    id: context.task.id, version: context.task.version,
    dependencies: [{ taskId: prerequisite.id, type: "BLOCKS" }]
  });
  assert.equal(context.task.actionable, false);
  assert(context.task.dependencies.some((item) => item.task.id === prerequisite.id && !item.resolved));
  const cycleError = await callError("plan_spore_task_dependencies", {
    id: prerequisite.id, version: prerequisite.version,
    dependencies: [{ taskId: context.task.id, type: "BLOCKS" }]
  });
  assert(cycleError.includes("cannot create a cycle"));
  let queue = await call<WorkQueue>("get_spore_work_queue");
  assert(queue.blocked.some((item) => item.id === context.task.id));

  const prerequisiteContext = await call<TaskContext>("submit_spore_completion", {
    id: prerequisite.id, version: prerequisite.version, summary: "Satisfied the dependency for queue verification."
  });
  assert.equal(prerequisiteContext.task.status, "DONE");
  queue = await call<WorkQueue>("get_spore_work_queue");
  assert(queue.actionable.some((item) => item.id === context.task.id));

  context = await call<TaskContext>("submit_spore_completion", {
    id: context.task.id, version: context.task.version, summary: "Verified the advisory handoff path.",
    checks: ["MCP resource, dependency queue, and structured output validated"]
  });
  assert.equal(context.task.status, "DONE");
  assert.equal(context.task.approvedAt, null);
  assert(context.task.artifacts.some((artifact) => artifact.title === "Completion handoff"));
  assert(context.activity.some((event) => event.action === "task.completion_submitted"));
  context = await call<TaskContext>("approve_spore_task", { id: context.task.id, version: context.task.version });
  assert(context.task.approvedAt);

  const stored = await db.task.findUniqueOrThrow({
    where: { id: context.task.id }, include: { activities: { orderBy: { createdAt: "asc" } } }
  });
  assert.deepEqual(stored.activities.map((event) => [event.action, event.actorType]), [
    ["task.created", "AI_TOOL"], ["task.updated", "AI_TOOL"], ["artifact.created", "AI_TOOL"],
    ["artifact.created", "AI_TOOL"], ["task.dependencies_replaced", "AI_TOOL"],
    ["task.completion_submitted", "AI_TOOL"], ["task.approved", "AI_TOOL"]
  ]);
  console.log(`MCP verified: ${tools.tools.length} tools, dependency-aware queue, completion evidence, AI approval, portable context, and history.`);
}

main().finally(async () => {
  await client.close();
  if (verificationTaskIds.size && !process.env.MCP_URL) {
    const ids = [...verificationTaskIds];
    await db.activity.deleteMany({ where: { taskId: { in: ids } } });
    await db.task.deleteMany({ where: { id: { in: ids } } });
  }
  await db.$disconnect();
});
