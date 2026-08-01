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
      "Only a human actor can approve completion",
      "Only a completed, active task can be approved",
      "A task must be approved before it can be archived",
      "Task is not archived",
      "Archive this project or reassign its tasks before deleting it"
    ];
    if (expected.includes(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
  }
  console.error(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
