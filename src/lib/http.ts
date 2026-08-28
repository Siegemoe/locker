import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function apiError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Invalid request", details: error.flatten() },
      { status: 400 }
    );
  }
  if (error instanceof Error) {
    const expected = [
      "Task changed since it was loaded",
      "Restore this task before editing it",
      "Only a completed, active task can be approved",
      "A task must be approved before it can be archived",
      "Task is not archived",
      "Archive this project or reassign its tasks before deleting it",
      "Archive this project or move its issues before deleting it",
      "The UNASSIGNED project is the default bucket for new issues and cannot be deleted",
      "Finalized Journal entries cannot be changed",
      "Journal contribution changed since it was loaded",
      "Journal contribution does not exist at that version",
      "Journal candidates must be unused events from the same day",
      "Journal entry is already finalized",
      "Journal entry changed since it was loaded",
      "Issue changed since it was loaded",
      "Reopen this issue before editing it",
      "Reassign this issue before moving it to another project",
      "Project must belong to the same workspace as the issue",
      "Journal candidate must belong to the same workspace as the issue",
      "No UNASSIGNED project exists in this workspace; create one or name a project",
      "Only an OPEN issue can move to triage",
      "Only an OPEN or IN TRIAGE issue can be resolved",
      "Only a RESOLVED issue can be verified closed",
      "Only a RESOLVED or CLOSED issue can be reopened",
      "Resolving as FIXED requires a note describing the fix",
      "Resolving as DUPLICATE requires the original issue",
      "Reopening an issue requires a note explaining what came back",
      "An issue cannot be a duplicate of itself",
      "Issues cannot be duplicates of each other",
      "Duplicate target must be an issue in the same workspace",
      "Reopen this issue before assigning it to a task",
      "Issue is already assigned to this task",
      "Task must be an active task in the same workspace as the issue",
      "Issues cannot attach to a DONE or CANCELED task",
      "Attach this issue to a task in its own project, or assign it to a new task",
      "An artifact needs exactly one owner: a task or an issue",
      "AI tools must record a completion handoff instead of marking tasks DONE directly",
      "USER_DECISION contributions record the human's voice and can only be written by the user"
    ];
    const expectedPrefixes = [
      // The close gate names the offending issue codes, so the message varies.
      "Resolve attached issues before completing this task:"
    ];
    if (expected.includes(error.message) || expectedPrefixes.some((prefix) => error.message.startsWith(prefix))) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
  }
  console.error(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
