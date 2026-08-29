import { NextRequest, NextResponse } from "next/server";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { journalContributionInputSchema } from "@/lib/journal-schema";
import { renderJournalMarkdown, upsertJournalContribution } from "@/lib/journal-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const entry = await upsertJournalContribution({
      workspaceId: (await params).workspaceId,
      ...journalContributionInputSchema.parse(await request.json())
    }, actor);
    return NextResponse.json({ data: { ...entry, markdown: renderJournalMarkdown(entry) } });
  } catch (error) {
    return apiError(error);
  }
}
