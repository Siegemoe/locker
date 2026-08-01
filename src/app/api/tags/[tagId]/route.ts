import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { archiveTag, updateTag } from "@/lib/workspace-service";

const schema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()
});
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tagId: string }> }) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ data: await updateTag((await params).tagId, schema.parse(await request.json()), actor) });
  } catch (error) { return apiError(error); }
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ tagId: string }> }) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ data: await archiveTag((await params).tagId, actor) });
  } catch (error) { return apiError(error); }
}
