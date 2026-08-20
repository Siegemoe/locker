import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { flagJournalCandidate, renderJournalMarkdown } from "@/lib/journal-service";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  authorKey: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/i),
  authorLabel: z.string().trim().min(1).max(120),
  modelId: z.string().trim().max(160).nullable().optional(),
  kind: z.enum(["DECISION", "REALIZATION", "MILESTONE", "DIRECTION_CHANGE", "ABANDONED_ASSUMPTION", "IDEA", "DISAGREEMENT", "FAILURE", "CHANGE_OF_MIND", "COMPLETION", "EVIDENCE"]),
  summary: z.string().trim().min(1).max(2_000),
  contextMarkdown: z.string().trim().max(20_000).nullable().optional(),
  importance: z.number().int().min(1).max(5).optional(),
  sourceReferences: z.array(z.string().trim().min(1).max(2_000)).max(50).optional(),
  projectId: z.string().uuid().nullable().optional()
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const entry = await flagJournalCandidate({
      workspaceId: (await params).workspaceId,
      ...schema.parse(await request.json())
    }, actor);
    return NextResponse.json({ data: { ...entry, markdown: renderJournalMarkdown(entry) } });
  } catch (error) {
    return apiError(error);
  }
}
