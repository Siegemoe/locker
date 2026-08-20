import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { searchJournal } from "@/lib/journal-service";

const querySchema = z.object({
  query: z.string().trim().min(1).max(500),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  authorKey: z.string().trim().max(80).optional(),
  topic: z.string().trim().max(80).optional(),
  projectId: z.string().uuid().optional(),
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
