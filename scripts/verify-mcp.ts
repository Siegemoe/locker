import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { db } from "../src/lib/db";

type Task = { id: string; title: string; status: string; version: number; approvedAt: string | null; tags: { id: string; name: string }[]; artifacts: { id: string; kind: string; title: string }[] };
type Board = { tasks: Task[]; archived: boolean; tags: { id: string; name: string }[] };
type Activity = { action: string; actorType: string; task: { id: string; title: string } | null };
type TaskContext = { task: Task; activity: Activity[] };
type Structure = { projects: { id: string; archivedAt: string | null; taskCount: number }[]; tags: { id: string; archivedAt: string | null; taskCount: number }[] };
type ActivityList = { activity: Activity[]; limit: number; truncated: boolean };

const tsxCli = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
const serverFile = fileURLToPath(new URL("../src/mcp/server.ts", import.meta.url));
const transport = process.env.MCP_URL
  ? new StreamableHTTPClientTransport(new URL(process.env.MCP_URL))
  : new StdioClientTransport({
      command: process.execPath,
      args: [tsxCli, "--env-file=.env", serverFile],
      cwd: process.cwd(),
      stderr: "pipe"
    });
const client = new Client({ name: "spore-locker-verifier", version: "0.1.0" });
let verificationTaskId: string | undefined;

async function call<T>(name: string, args: Record<string, unknown> = {}) {
  const response = await client.callTool({ name, arguments: args });
  assert(!response.isError, JSON.stringify(response));
  return response.structuredContent as T;
}

async function main() {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = new Set(tools.tools.map((tool) => tool.name));
  for (const name of [
    "open_spore_locker", "get_spore_task_context", "list_spore_workspace_structure",
    "submit_spore_completion", "attach_spore_workspace_reference", "list_spore_activity"
  ]) assert(names.has(name), `Missing MCP tool: ${name}`);
  assert(!names.has("approve_spore_task"), "Unauthenticated MCP must not expose human approval");

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
  assert("text" in html && html.text.includes("Ready for human review"));
  assert("text" in html && !html.text.includes("approve_spore_task"));

  const initial = await call<Board>("open_spore_locker");
  assert.equal(initial.archived, false);
  const structure = await call<Structure>("list_spore_workspace_structure", { includeArchived: true });
  assert(structure.projects.every((item) => typeof item.taskCount === "number"));
  assert(structure.tags.every((item) => typeof item.taskCount === "number"));
  const recent = await call<ActivityList>("list_spore_activity", { limit: 5 });
  assert.equal(recent.limit, 5);

  if (process.env.MCP_URL) {
    console.log(`Remote MCP verified read-only: ${tools.tools.length} tools, card resource, structure, and activity.`);
    return;
  }

  const tag = initial.tags[0];
  let board = await call<Board>("capture_spore_task", { title: "MCP advisory verification item", priority: "HIGH", tagIds: tag ? [tag.id] : [] });
  let task = board.tasks.find((item) => item.title === "MCP advisory verification item");
  assert(task);
  verificationTaskId = task.id;
  if (tag) assert(task.tags.some((item) => item.id === tag.id));
  board = await call<Board>("attach_spore_context", { taskId: task.id, kind: "LINK", title: "Verification context", url: "https://excalidraw.com/" });
  task = board.tasks.find((item) => item.id === task!.id);
  assert(task);
  assert(task.artifacts.some((artifact) => artifact.title === "Verification context"));

  let context = await call<TaskContext>("attach_spore_workspace_reference", {
    taskId: task.id, title: "Implementation plan", workspace: "spore-locker",
    relativePath: "docs/plans/advisory-mcp.md", revision: "main", note: "Portable reference only"
  });
  assert(context.task.artifacts.some((artifact) => artifact.title === "Implementation plan" && artifact.kind === "TEXT"));

  context = await call<TaskContext>("submit_spore_completion", {
    id: context.task.id, version: context.task.version, summary: "Verified the advisory handoff path.",
    checks: ["MCP resource and structured output validated"], unresolved: ["Human review remains external to MCP"]
  });
  assert.equal(context.task.status, "DONE");
  assert.equal(context.task.approvedAt, null);
  assert(context.task.artifacts.some((artifact) => artifact.title === "Completion handoff"));
  assert(context.activity.some((event) => event.action === "task.completion_submitted"));

  const stored = await db.task.findUniqueOrThrow({
    where: { id: context.task.id }, include: { activities: { orderBy: { createdAt: "asc" } } }
  });
  assert.deepEqual(stored.activities.map((event) => [event.action, event.actorType]), [
    ["task.created", "AI_TOOL"], ["artifact.created", "AI_TOOL"],
    ["artifact.created", "AI_TOOL"], ["task.completion_submitted", "AI_TOOL"]
  ]);
  console.log(`MCP verified: ${tools.tools.length} advisory tools, completion handoff, portable context, history, and no approval authority.`);
}

main().finally(async () => {
  await client.close();
  if (verificationTaskId && !process.env.MCP_URL) {
    await db.activity.deleteMany({ where: { taskId: verificationTaskId } });
    await db.task.deleteMany({ where: { id: verificationTaskId } });
  }
  await db.$disconnect();
});
