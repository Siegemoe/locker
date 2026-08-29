import { Prisma } from "@prisma/client";
import { ExpectedError } from "@/lib/expected-error";

/**
 * The close gate's enforcement: a task cannot complete while issues attached
 * to it are OPEN or IN TRIAGE. This module is neutral ground between the
 * gate's two contenders — completion lives in task-service, issue assignment
 * lives in issue-service — and owns the lock-then-check ordering so neither
 * path can slip past the other's check regardless of arrival order.
 */

/** Lock a task row so the close gate and issue assignment cannot interleave. */
export async function lockTaskRow(tx: Prisma.TransactionClient, taskId: string) {
  await tx.$queryRaw`SELECT id FROM "Task" WHERE id = CAST(${taskId} AS uuid) FOR UPDATE`;
}

/** The gate check: no task completes while issues attached to it are OPEN or IN TRIAGE. */
export async function assertNoOpenIssues(tx: Prisma.TransactionClient, taskId: string) {
  const blocking = await tx.issue.findMany({
    where: { assignedTaskId: taskId, status: { in: ["OPEN", "TRIAGED"] } },
    select: { code: true, title: true },
    orderBy: { code: "asc" }
  });
  if (!blocking.length) return;
  const shown = blocking.slice(0, 5).map((issue) => `${issue.code} "${issue.title}"`).join(", ");
  const extra = blocking.length > 5 ? ` and ${blocking.length - 5} more` : "";
  throw new ExpectedError(`Resolve attached issues before completing this task: ${shown}${extra}`);
}

/** Every terminal completion path goes through here: the lock, then the check. */
export async function enforceCloseGate(tx: Prisma.TransactionClient, taskId: string) {
  await lockTaskRow(tx, taskId);
  await assertNoOpenIssues(tx, taskId);
}
