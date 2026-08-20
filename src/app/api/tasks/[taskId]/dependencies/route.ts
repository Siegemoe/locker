import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { replaceTaskDependencies } from "@/lib/task-service";

const dependencyPlanSchema = z.object({
  version: z.number().int().positive(),
  dependencies: z.array(z.object({
    taskId: z.string().uuid(),
    type: z.enum(["BLOCKS", "RELATES_TO", "DUPLICATES"])
  })).max(100)
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { taskId } = await params;
    const { version, dependencies } = dependencyPlanSchema.parse(await request.json());
    return NextResponse.json({
      data: await replaceTaskDependencies(taskId, version, dependencies, actor)
    });
  } catch (error) {
    return apiError(error);
  }
}
