import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { journalSearchInputSchema } from "@/lib/journal-schema";
import { searchJournal } from "@/lib/journal-service";

// Query params arrive as strings; the transport coerces the numeric filters.
const querySchema = journalSearchInputSchema
  .omit({ minImportance: true, limit: true })
  .extend({
    minImportance: z.coerce.number().int().min(1).max(5).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional()
  });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    if (!actorFromRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const input = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json({ data: await searchJournal((await params).workspaceId, input) });
  } catch (error) {
    return apiError(error);
  }
}
