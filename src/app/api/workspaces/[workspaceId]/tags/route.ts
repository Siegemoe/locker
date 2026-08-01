import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { createTag } from "@/lib/workspace-service";

const schema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
});
export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ data: await createTag({ workspaceId: (await params).workspaceId, ...schema.parse(await request.json()) }, actor) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
