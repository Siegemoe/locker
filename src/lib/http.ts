import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ExpectedError } from "@/lib/expected-error";

export function apiError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Invalid request", details: error.flatten() },
      { status: 400 }
    );
  }
  // The throw site classifies: an ExpectedError is a conflict a caller can
  // resolve (version guard, gate refusal, ownership rule); anything else is a
  // bug or a race and must not be presented as recoverable.
  if (error instanceof ExpectedError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  console.error(error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
