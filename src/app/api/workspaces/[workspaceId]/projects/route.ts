import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { createProject } from "@/lib/workspace-service";

const schema = z.object({
  key: z.string().trim().min(1).max(12).regex(/^[A-Za-z0-9-]+$/).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(5000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { workspaceId } = await params;
    return NextResponse.json({ data: await createProject({ workspaceId, ...schema.parse(await request.json()) }, actor) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
