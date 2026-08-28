import assert from "node:assert/strict";
import type { Issue } from "@prisma/client";
import { db } from "../src/lib/db";
import {
  assignIssue,
  createIssue,
  issueContext,
  issueLifecycle,
  listIssues,
  updateIssue
} from "../src/lib/issue-service";
import { approveTask, createTask, submitTaskCompletion, updateTask } from "../src/lib/task-service";
import { createArtifact, createProject, deleteEmptyProject } from "../src/lib/workspace-service";

const actor = { type: "USER" as const, label: "Issues verifier" };
const CODE_PATTERN = /^[2-9A-HJKM-NP-Z]{7}$/;
const cleanupIssues = new Set<string>();
const cleanupTasks = new Set<string>();
let cleanupProjectId: string | null = null;

async function main() {
  const workspace = await db.workspace.findUniqueOrThrow({ where: { slug: "spore-locker" } });
  const project = await db.project.findUniqueOrThrow({
    where: { workspaceId_key: { workspaceId: workspace.id, key: "SPORE" } }
  });

  // Filing without a project lands in the UNASSIGNED bucket with a work-order code.
  let issueA: Issue = await createIssue({
    workspaceId: workspace.id,
    title: "Verification issue: submit button missing",
    details: "Reported by the issues verifier",
    severity: "HIGH"
  }, actor);
  cleanupIssues.add(issueA.id);
  assert.match(issueA.code, CODE_PATTERN);
  assert.equal(issueA.status, "OPEN");
  const bucket = await db.project.findUniqueOrThrow({ where: { id: issueA.projectId } });
  assert.equal(bucket.key, "UNASSIGNED");

  issueA = await updateIssue(issueA.id, issueA.version, { severity: "CRITICAL" }, actor);
  assert.equal(issueA.severity, "CRITICAL");
  await assert.rejects(
    updateIssue(issueA.id, issueA.version - 1, { severity: "LOW" }, actor),
    /changed since it was loaded/
  );

  // Issues attach only to tasks in their own project.
  const task = await createTask({ workspaceId: workspace.id, projectId: project.id, title: "Verification issue fix" }, actor);
  cleanupTasks.add(task.id);
  await assert.rejects(assignIssue(issueA.id, issueA.version, { taskId: task.id }, actor), /own project/);

  let issueB: Issue = await createIssue({
    workspaceId: workspace.id, projectId: project.id,
    kind: "REGRESSION", title: "Verification issue: counts drift"
  }, actor);
  cleanupIssues.add(issueB.id);
  issueB = await assignIssue(issueB.id, issueB.version, { taskId: task.id }, actor);
  assert.equal(issueB.status, "TRIAGED");
  assert.equal(issueB.assignedTaskId, task.id);
  await assert.rejects(assignIssue(issueB.id, issueB.version, { taskId: task.id }, actor), /already assigned/);

  // The close gate refuses completion while attached issues are OPEN or IN TRIAGE.
  await assert.rejects(updateTask(task.id, task.version, { status: "DONE" }, actor), /Resolve attached issues/);
  await assert.rejects(
    submitTaskCompletion(task.id, task.version, { summary: "Too early" }, actor),
    /Resolve attached issues/
  );

  // FIXED requires an evidence note and rests at RESOLVED.
  await assert.rejects(
    issueLifecycle(issueB.id, issueB.version, "resolve", { closeReason: "FIXED" }, actor),
    /requires a note/
  );
  issueB = await issueLifecycle(issueB.id, issueB.version, "resolve", { closeReason: "FIXED", note: "Counts reconciled" }, actor);
  assert.equal(issueB.status, "RESOLVED");
  assert(issueB.resolvedAt);

  // With every attached issue resolved, completion goes through.
  const done = await submitTaskCompletion(task.id, task.version, { summary: "Counts fixed" }, actor);
  assert.equal(done.status, "DONE");

  // Reopening works only from RESOLVED/CLOSED, requires a note, clears the assignment.
  await assert.rejects(
    issueLifecycle(issueA.id, issueA.version, "reopen", { note: "Not resolved yet" }, actor),
    /RESOLVED or CLOSED/
  );
  issueB = await issueLifecycle(issueB.id, issueB.version, "reopen", { note: "Drift came back" }, actor);
  assert.equal(issueB.status, "OPEN");
  assert.equal(issueB.assignedTaskId, null);
  const approved = await approveTask(done.id, done.version, actor);
  assert(approved.approvedAt);

  // No backdoor into the gate: a DONE task cannot take a new issue.
  await assert.rejects(assignIssue(issueB.id, issueB.version, { taskId: task.id }, actor), /DONE or CANCELED/);

  // Assigning to a new task creates it inside the issue's project.
  const assignedA = await assignIssue(issueA.id, issueA.version, { newTask: { title: "Fix submit button", priority: "HIGH" } }, actor);
  cleanupTasks.add(assignedA.assignedTask!.id);
  assert.equal(assignedA.status, "TRIAGED");
  assert.equal(assignedA.assignedTask!.projectId, bucket.id);

  // Resolving as DUPLICATE needs the original.
  const issueC = await createIssue({ workspaceId: workspace.id, projectId: project.id, title: "Verification issue: drift again" }, actor);
  cleanupIssues.add(issueC.id);
  await assert.rejects(
    issueLifecycle(issueC.id, issueC.version, "resolve", { closeReason: "DUPLICATE" }, actor),
    /requires the original/
  );
  const closedC = await issueLifecycle(issueC.id, issueC.version, "resolve", { closeReason: "DUPLICATE", duplicateOfId: issueB.id }, actor);
  assert.equal(closedC.status, "CLOSED");
  assert.equal(closedC.closeReason, "DUPLICATE");

  // A duplicate marked while still open cascades the original's closure.
  let issueD: Issue = await createIssue({ workspaceId: workspace.id, projectId: project.id, title: "Verification issue: same drift" }, actor);
  cleanupIssues.add(issueD.id);
  issueD = await updateIssue(issueD.id, issueD.version, { duplicateOfId: issueB.id }, actor);
  const closedB = await issueLifecycle(issueB.id, issueB.version, "resolve", { closeReason: "WONT_FIX", note: "Not worth fixing" }, actor);
  assert.equal(closedB.status, "CLOSED");
  const driftedD = await db.issue.findUniqueOrThrow({ where: { id: issueD.id } });
  assert.equal(driftedD.status, "CLOSED");
  assert.equal(driftedD.closeReason, "WONT_FIX");

  // Attachments are metadata-only artifacts with exactly one owner.
  const artifact = await createArtifact(
    { issueId: issueA.id, kind: "LINK", title: "Broken submit", url: "https://example.test/submit.png" },
    actor
  );
  assert.equal(artifact.issueId, issueA.id);
  assert.equal(artifact.taskId, null);
  await assert.rejects(
    createArtifact({ taskId: task.id, issueId: issueA.id, kind: "LINK", title: "Ambiguous owner" }, actor),
    /exactly one owner/
  );

  // Issues pin their project against deletion; the UNASSIGNED bucket is permanent.
  const scratch = await createProject({ workspaceId: workspace.id, key: "ISSUE-VERIFY", name: "Issue verifier scratch" }, actor);
  cleanupProjectId = scratch.id;
  let issueE: Issue = await createIssue({ workspaceId: workspace.id, title: "Verification issue: parked in scratch" }, actor);
  cleanupIssues.add(issueE.id);
  issueE = await updateIssue(issueE.id, issueE.version, { projectId: scratch.id }, actor);
  assert.equal(issueE.projectId, scratch.id);
  await assert.rejects(deleteEmptyProject(scratch.id, actor), /move its issues/);
  await assert.rejects(deleteEmptyProject(bucket.id, actor), /UNASSIGNED/);

  const unassigned = await listIssues(workspace.id, { unassignedOnly: true });
  assert(unassigned.some((issue) => issue.id === issueE.id));
  assert(!unassigned.some((issue) => issue.id === issueA.id));
  const context = await issueContext(workspace.id, issueA.id);
  assert.equal(context.code, issueA.code);
  assert(context.activities.some((event) => event.action === "issue.assigned"));

  const stored = await db.issue.findUniqueOrThrow({
    where: { id: issueB.id },
    include: { activities: { orderBy: { createdAt: "asc" } } }
  });
  assert.deepEqual(stored.activities.map((event) => event.action), [
    "issue.filed", "issue.assigned", "issue.resolved", "issue.reopened", "issue.resolved"
  ]);
  console.log(`Issues verified: ${stored.activities.length} immutable events on ${stored.code}; gate held at every step.`);
}

main().finally(async () => {
  const issueIds = [...cleanupIssues];
  const taskIds = [...cleanupTasks];
  if (issueIds.length) {
    await db.activity.deleteMany({ where: { issueId: { in: issueIds } } });
    await db.issue.deleteMany({ where: { id: { in: issueIds } } });
  }
  if (taskIds.length) {
    await db.activity.deleteMany({ where: { taskId: { in: taskIds } } });
    await db.task.deleteMany({ where: { id: { in: taskIds } } });
  }
  if (cleanupProjectId) {
    await db.project.deleteMany({ where: { id: cleanupProjectId, key: "ISSUE-VERIFY" } });
  }
  await db.$disconnect();
});
