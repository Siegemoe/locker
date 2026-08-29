import { NextRequest, NextResponse } from "next/server";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { journalCandidateInputSchema } from "@/lib/journal-schema";
import { flagJournalCandidate, renderJournalMarkdown } from "@/lib/journal-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const entry = await flagJournalCandidate({
      workspaceId: (await params).workspaceId,
      ...journalCandidateInputSchema.parse(await request.json())
    }, actor);
    return NextResponse.json({ data: { ...entry, markdown: renderJournalMarkdown(entry) } });
  } catch (error) {
    return apiError(error);
  }
}
