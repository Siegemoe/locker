import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import {
  approveTask,
  archiveTask,
  createTask,
  listTasks,
  restoreTask,
  updateTask
} from "../src/lib/task-service";

const actor = { type: "USER" as const, label: "Lifecycle verifier" };

async function main() {
  const workspace = await db.workspace.findUniqueOrThrow({ where: { slug: "spore-locker" } });
  let task = await createTask({
    workspaceId: workspace.id,
    title: "Lifecycle verification item",
    description: "Captured for end-to-end verification",
    status: "BACKLOG",
    priority: "HIGH"
  }, actor);
  task = await updateTask(task.id, task.version, {
    status: "IN_PROGRESS",
    description: "Execution recorded by local actor"
  }, actor);
  task = await updateTask(task.id, task.version, { status: "DONE" }, actor);
  assert(task.completedAt);
  task = await approveTask(task.id, task.version, actor);
  assert(task.approvedAt);
  task = await archiveTask(task.id, task.version, actor);
  assert(task.archivedAt);
  assert(!(await listTasks(workspace.id)).some((item) => item.id === task.id));
  assert((await listTasks(workspace.id, undefined, true)).some((item) => item.id === task.id));
  task = await restoreTask(task.id, task.version, actor);
  assert.equal(task.archivedAt, null);
  task = await archiveTask(task.id, task.version, actor);
  const stored = await db.task.findUniqueOrThrow({
    where: { id: task.id },
    include: { activities: { orderBy: { createdAt: "asc" } } }
  });
  assert.deepEqual(stored.activities.map((event) => event.action), [
    "task.created", "task.updated", "task.updated", "task.approved",
    "task.archived", "task.restored", "task.archived"
  ]);
  console.log(`Lifecycle verified: ${stored.activities.length} immutable events; final state archived.`);
}

main().finally(() => db.$disconnect());
