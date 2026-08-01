import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { listActivity } from "@/lib/workspace-service";

const querySchema = z.object({
  projectId: z.string().uuid().optional(), tagId: z.string().uuid().optional(),
  actorType: z.enum(["USER", "AI_TOOL", "SYSTEM"]).optional(),
  action: z.string().max(80).optional(), taskId: z.string().uuid().optional(),
  days: z.coerce.number().int().min(1).max(3650).optional()
});
export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    if (!actorFromRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const input = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json({
      data: await listActivity((await params).workspaceId, {
        ...input, since: input.days ? new Date(Date.now() - input.days * 86400000) : undefined
      })
    });
  } catch (error) { return apiError(error); }
}
