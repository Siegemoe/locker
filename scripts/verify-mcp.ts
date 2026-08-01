import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { db } from "../src/lib/db";

type Task = { id: string; title: string; status: string; version: number; approvedAt: string | null; tags: { id: string; name: string }[]; artifacts: { id: string; kind: string; title: string }[] };
type Board = { tasks: Task[]; archived: boolean; tags: { id: string; name: string }[] };

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

async function call(name: string, args: Record<string, unknown> = {}) {
  const response = await client.callTool({ name, arguments: args });
  assert(!response.isError, JSON.stringify(response));
  return response.structuredContent as Board;
}

async function main() {
  await client.connect(transport);
  const tools = await client.listTools();
  assert(tools.tools.some((tool) => tool.name === "open_spore_locker"));
  assert(tools.tools.some((tool) => tool.name === "approve_spore_task" && tool._meta?.ui));

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

  const initial = await call("open_spore_locker");
  assert.equal(initial.archived, false);
  const tag = initial.tags[0];
  let board = await call("capture_spore_task", { title: "MCP card verification item", priority: "HIGH", tagIds: tag ? [tag.id] : [] });
  let task = board.tasks.find((item) => item.title === "MCP card verification item");
  assert(task);
  if (tag) assert(task.tags.some((item) => item.id === tag.id));
  board = await call("attach_spore_context", { taskId: task.id, kind: "LINK", title: "Verification context", url: "https://excalidraw.com/" });
  task = board.tasks.find((item) => item.id === task!.id);
  assert(task);
  assert(task.artifacts.some((artifact) => artifact.title === "Verification context"));
  board = await call("update_spore_task", { id: task.id, version: task.version, status: "DONE" });
  task = board.tasks.find((item) => item.id === task!.id);
  assert.equal(task?.status, "DONE");
  board = await call("approve_spore_task", { id: task!.id, version: task!.version });
  task = board.tasks.find((item) => item.id === task!.id);
  assert(task?.approvedAt);
  await call("archive_spore_task", { id: task!.id, version: task!.version });
  const archived = await call("list_spore_tasks", { archived: true });
  assert(archived.tasks.some((item) => item.id === task!.id));

  if (!process.env.MCP_URL) {
    const stored = await db.task.findUniqueOrThrow({
      where: { id: task!.id }, include: { activities: { orderBy: { createdAt: "asc" } } }
    });
    assert.deepEqual(stored.activities.map((event) => [event.action, event.actorType]), [
      ["task.created", "AI_TOOL"], ["artifact.created", "AI_TOOL"], ["task.updated", "AI_TOOL"],
      ["task.approved", "USER"], ["task.archived", "AI_TOOL"]
    ]);
  }
  console.log(`MCP verified: ${tools.tools.length} tools, explicit tags, artifact context, inline card resource, and actor-safe approval.`);
}

main().finally(async () => {
  await client.close();
  await db.$disconnect();
});
