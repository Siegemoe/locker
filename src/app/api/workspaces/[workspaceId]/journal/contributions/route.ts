import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { renderJournalMarkdown, upsertJournalContribution } from "@/lib/journal-service";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  authorKey: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/i),
  authorLabel: z.string().trim().min(1).max(120),
  modelId: z.string().trim().max(160).nullable().optional(),
  role: z.enum(["REFLECTION", "USER_DECISION", "AGENT_OBSERVATION", "AGENT_HYPOTHESIS", "AGENT_RECOMMENDATION", "OBJECTIVE_ACTIVITY"]).optional(),
  bodyMarkdown: z.string().trim().min(1).max(100_000),
  topics: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  importance: z.number().int().min(1).max(5).optional(),
  sourceReferences: z.array(z.string().trim().min(1).max(2_000)).max(50).optional(),
  projectIds: z.array(z.string().uuid()).max(50).optional(),
  candidateIds: z.array(z.string().uuid()).max(100).optional(),
  version: z.number().int().positive().optional()
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const entry = await upsertJournalContribution({
      workspaceId: (await params).workspaceId,
      ...schema.parse(await request.json())
    }, actor);
    return NextResponse.json({ data: { ...entry, markdown: renderJournalMarkdown(entry) } });
  } catch (error) {
    return apiError(error);
  }
}
