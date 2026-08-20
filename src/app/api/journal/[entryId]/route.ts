import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { finalizeJournalEntry, renderJournalMarkdown } from "@/lib/journal-service";

const schema = z.object({ version: z.number().int().positive(), action: z.literal("finalize") });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entryId: string }> }
) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { version } = schema.parse(await request.json());
    const entry = await finalizeJournalEntry((await params).entryId, version, actor);
    return NextResponse.json({ data: { ...entry, markdown: renderJournalMarkdown(entry) } });
  } catch (error) {
    return apiError(error);
  }
}
