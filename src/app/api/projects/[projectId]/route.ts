import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { archiveProject, deleteEmptyProject, restoreProject, updateProject } from "@/lib/workspace-service";

const patchSchema = z.object({
  key: z.string().trim().min(1).max(12).regex(/^[A-Za-z0-9-]+$/).transform((value) => value.toUpperCase()).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(5000).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()
});
const actionSchema = z.object({ action: z.enum(["archive", "restore", "delete"]) });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ data: await updateProject((await params).projectId, patchSchema.parse(await request.json()), actor) });
  } catch (error) { return apiError(error); }
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { action } = actionSchema.parse(await request.json());
    const id = (await params).projectId;
    const data = action === "archive"
      ? await archiveProject(id, actor)
      : action === "restore"
        ? await restoreProject(id, actor)
        : await deleteEmptyProject(id, actor);
    return NextResponse.json({ data });
  } catch (error) { return apiError(error); }
}
