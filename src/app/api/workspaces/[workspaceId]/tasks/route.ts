import { NextRequest, NextResponse } from "next/server";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { taskCreateInputSchema } from "@/lib/task-schema";
import { createTask, listTasks } from "@/lib/task-service";

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
    const input = taskCreateInputSchema.parse(await request.json());
    const task = await createTask({ workspaceId, ...input }, actor);
    return NextResponse.json({ data: task }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
