import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { taskUpdateInputSchema } from "@/lib/task-schema";
import { approveTask, archiveTask, restoreTask, updateTask } from "@/lib/task-service";

const updateSchema = taskUpdateInputSchema.extend({ version: z.number().int().positive() });

const actionSchema = z.object({
  version: z.number().int().positive(),
  action: z.enum(["approve", "archive", "restore"])
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { taskId } = await params;
    const { version, ...patch } = updateSchema.parse(await request.json());
    return NextResponse.json({ data: await updateTask(taskId, version, patch, actor) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { taskId } = await params;
    const input = actionSchema.parse(await request.json());
    const operation = input.action === "approve" ? approveTask : input.action === "archive" ? archiveTask : restoreTask;
    return NextResponse.json({ data: await operation(taskId, input.version, actor) });
  } catch (error) {
    return apiError(error);
  }
}
