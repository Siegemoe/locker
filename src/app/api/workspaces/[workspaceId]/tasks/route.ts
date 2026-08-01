import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { createTask, listTasks } from "@/lib/task-service";

const createSchema = z.object({
  projectId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional(),
  status: z.enum(["BACKLOG", "READY", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional()
  ,tagIds: z.array(z.string().uuid()).max(20).optional()
});

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { workspaceId } = await context.params;
    const projectId = request.nextUrl.searchParams.get("projectId") ?? undefined;
    const archived = request.nextUrl.searchParams.get("archived") === "true";
    return NextResponse.json({ data: await listTasks(workspaceId, projectId, archived) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { workspaceId } = await context.params;
    const input = createSchema.parse(await request.json());
    const task = await createTask({ workspaceId, ...input }, actor);
    return NextResponse.json({ data: task }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
