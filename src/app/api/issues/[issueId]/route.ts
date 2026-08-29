import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import {
  issueAssignSchema, issueLifecycleInputSchema, issueUpdateInputSchema
} from "@/lib/issue-schema";
import { assignIssue, issueContext, issueLifecycle, updateIssue } from "@/lib/issue-service";

const updateSchema = issueUpdateInputSchema.extend({ version: z.number().int().positive() });

type Context = { params: Promise<{ issueId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { issueId } = await context.params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId query parameter is required" }, { status: 400 });
    return NextResponse.json({ data: await issueContext(workspaceId, issueId) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { issueId } = await context.params;
    const { version, ...patch } = updateSchema.parse(await request.json());
    return NextResponse.json({ data: await updateIssue(issueId, version, patch, actor) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { issueId } = await context.params;
    const body: unknown = await request.json();
    if ((body as { action?: string })?.action === "assign") {
      const input = issueAssignSchema.parse(body);
      const payload = input.newTask ? { newTask: input.newTask } : { taskId: input.taskId! };
      return NextResponse.json({ data: await assignIssue(issueId, input.version, payload, actor) });
    }
    const input = issueLifecycleInputSchema.parse(body);
    const operation =
      input.action === "triage"
        ? (id: string, version: number) => issueLifecycle(id, version, "triage", { severity: input.severity }, actor)
        : input.action === "resolve"
          ? (id: string, version: number) => issueLifecycle(id, version, "resolve", { closeReason: input.closeReason, note: input.note, duplicateOfId: input.duplicateOfId }, actor)
          : input.action === "verify"
            ? (id: string, version: number) => issueLifecycle(id, version, "verify", {}, actor)
            : (id: string, version: number) => issueLifecycle(id, version, "reopen", { note: input.note }, actor);
    return NextResponse.json({ data: await operation(issueId, input.version) });
  } catch (error) {
    return apiError(error);
  }
}
