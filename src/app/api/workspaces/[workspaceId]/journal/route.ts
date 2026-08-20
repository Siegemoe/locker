import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getJournalEntry, renderJournalMarkdown } from "@/lib/journal-service";

const querySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    if (!actorFromRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { date } = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const entry = await getJournalEntry((await params).workspaceId, date);
    return NextResponse.json({ data: entry ? { ...entry, markdown: renderJournalMarkdown(entry) } : null });
  } catch (error) {
    return apiError(error);
  }
}
