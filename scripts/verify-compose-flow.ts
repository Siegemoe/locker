import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type Activity = { action: string; actorType: string; actorLabel: string };
type ApiTask = { id: string; title: string; status: string; version: number; approvedAt: string | null; activities: Activity[]; tags: { tag: { id: string; name: string } }[]; artifacts: { id: string; title: string; kind: string }[] };
type McpTask = { id: string; title: string; status: string; version: number; approvedAt: string | null; tags: { id: string; name: string }[]; artifacts: { id: string; title: string; kind: string }[] };
type Board = { tasks: McpTask[]; archived: boolean };
type Project = { id: string; key: string; name: string };
type Tag = { id: string; name: string };

const appBase = "http://127.0.0.1:3000";
const client = new Client({ name: "spore-locker-compose-verifier", version: "0.1.0" });

async function api(path: string, options?: RequestInit) {
  const response = await fetch(`${appBase}${path}`, options);
  const body = await response.json();
  assert(response.ok, `${response.status}: ${JSON.stringify(body)}`);
  return body.data;
}

async function tool(name: string, args: Record<string, unknown> = {}) {
  const response = await client.callTool({ name, arguments: args });
  assert(!response.isError, JSON.stringify(response));
  return response.structuredContent as Board;
}

async function main() {
  const health = await fetch(`${appBase}/api/health`);
  assert.equal(health.status, 200);
  const workspace = await api("/api/workspace");
  const suffix = Date.now().toString(36).slice(-6).toUpperCase();
  const project = await api(`/api/workspaces/${workspace.id}/projects`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: `V${suffix}`, name: `Verification ${suffix}`, color: "#8ec6ff" })
  }) as Project;
  const tag = await api(`/api/workspaces/${workspace.id}/tags`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `MCP Verify ${suffix}`, color: "#c5f779" })
  }) as Tag;
  const renamedProject = await api(`/api/projects/${project.id}`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `Verification renamed ${suffix}`, color: "#d4a7ff" })
  }) as Project;
  assert.equal(renamedProject.name, `Verification renamed ${suffix}`);
  const renamedTag = await api(`/api/tags/${tag.id}`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `MCP Updated ${suffix}`, color: "#efb86b" })
  }) as Tag;
  assert.equal(renamedTag.name, `MCP Updated ${suffix}`);
  const created = await api(`/api/workspaces/${workspace.id}/tasks`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: `Ready-state shared workflow check ${suffix}`, description: "Safe verification task",
      status: "BACKLOG", projectId: project.id, tagIds: [tag.id]
    })
  }) as ApiTask;
  await api(`/api/tasks/${created.id}/artifacts`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "LINK", title: "Excalidraw verification", url: "https://excalidraw.com/" })
  });
  await api(`/api/tasks/${created.id}/artifacts`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "FILE_METADATA", title: "Specification metadata", fileName: "specification.pdf",
      mimeType: "application/pdf", sizeBytes: 4096
    })
  });
  let task = await api(`/api/tasks/${created.id}`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: created.version, status: "READY", description: "Human shaped this task in the local UI path" })
  }) as ApiTask;

  await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8787/mcp")));
  const opened = await tool("open_spore_locker");
  let shared = opened.tasks.find((item) => item.id === task.id);
  assert(shared);
  assert(shared.tags.some((item) => item.id === tag.id));
  assert(shared.artifacts.some((item) => item.title === "Excalidraw verification"));
  assert(shared.artifacts.some((item) => item.title === "Specification metadata" && item.kind === "FILE_METADATA"));
  let board = await tool("attach_spore_context", {
    taskId: task.id, kind: "TEXT", title: "MCP execution note", textContent: "Shared Markdown context"
  });
  shared = board.tasks.find((item) => item.id === task.id);
  assert(shared?.artifacts.some((item) => item.title === "MCP execution note"));
  board = await tool("update_spore_task", { id: task.id, version: task.version, status: "IN_PROGRESS" });
  let mcpTask = board.tasks.find((item) => item.id === task.id);
  assert.equal(mcpTask?.status, "IN_PROGRESS");
  board = await tool("update_spore_task", { id: task.id, version: mcpTask!.version, status: "DONE" });
  mcpTask = board.tasks.find((item) => item.id === task.id);
  assert.equal(mcpTask?.status, "DONE");

  task = await api(`/api/tasks/${task.id}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: mcpTask!.version, action: "approve" })
  }) as ApiTask;
  assert(task.approvedAt);
  await tool("archive_spore_task", { id: task.id, version: task.version });
  const active = await api(`/api/workspaces/${workspace.id}/tasks`) as ApiTask[];
  assert(!active.some((item) => item.id === task.id));
  const archived = await api(`/api/workspaces/${workspace.id}/tasks?archived=true`) as ApiTask[];
  const stored = archived.find((item) => item.id === task.id);
  assert(stored);
  assert.deepEqual(stored.activities.slice(0, 9).map((event) => [event.action, event.actorType]), [
    ["task.archived", "AI_TOOL"], ["task.approved", "USER"], ["task.updated", "AI_TOOL"],
    ["task.updated", "AI_TOOL"], ["artifact.created", "AI_TOOL"], ["task.updated", "USER"],
    ["artifact.created", "USER"], ["artifact.created", "USER"], ["task.created", "USER"]
  ]);

  const unsafeDelete = await fetch(`${appBase}/api/projects/${project.id}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete" })
  });
  assert.equal(unsafeDelete.status, 409);
  await api(`/api/projects/${project.id}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "archive" })
  });
  await api(`/api/tags/${tag.id}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "archive" })
  });
  const emptyProject = await api(`/api/workspaces/${workspace.id}/projects`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: `E${suffix}`, name: `Empty ${suffix}` })
  }) as Project;
  await api(`/api/projects/${emptyProject.id}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete" })
  });

  const projectActivity = await api(`/api/workspaces/${workspace.id}/activity?projectId=${project.id}&taskId=${task.id}&days=7`) as Activity[];
  assert(projectActivity.some((event) => event.action === "task.created" && event.actorType === "USER"));
  const tagActivity = await api(`/api/workspaces/${workspace.id}/activity?tagId=${tag.id}&action=task.&days=7`) as Activity[];
  assert(tagActivity.some((event) => event.action === "task.archived" && event.actorType === "AI_TOOL"));
  const artifactActivity = await api(`/api/workspaces/${workspace.id}/activity?action=artifact.&taskId=${task.id}&days=7`) as Activity[];
  assert.equal(artifactActivity.filter((event) => event.action === "artifact.created").length, 3);
  const deletedActivity = await api(`/api/workspaces/${workspace.id}/activity?action=project.deleted&days=7`) as Activity[];
  assert(deletedActivity.some((event) => event.action === "project.deleted"));
  console.log("Compose flow verified: projects, tags, artifacts, filtered immutable activity, safe deletion, shared MCP data, approval, and archive.");
}

main().finally(() => client.close());
