import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { assignIssue, issueContext, issueLifecycle, updateIssue } from "@/lib/issue-service";

const updateSchema = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  details: z.string().max(20_000).nullable().optional(),
  kind: z.enum(["BUG", "REGRESSION", "DEBT"]).optional(),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
  projectId: z.string().uuid().optional(),
  duplicateOfId: z.string().uuid().nullable().optional()
});

const lifecycleSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("triage"),
    version: z.number().int().positive(),
    severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional()
  }),
  z.object({
    action: z.literal("resolve"),
    version: z.number().int().positive(),
    closeReason: z.enum(["FIXED", "WONT_FIX", "DUPLICATE", "NOT_A_BUG"]).optional(),
    note: z.string().max(20_000).optional(),
    duplicateOfId: z.string().uuid().optional()
  }),
  z.object({ action: z.literal("verify"), version: z.number().int().positive() }),
  z.object({
    action: z.literal("reopen"),
    version: z.number().int().positive(),
    note: z.string().trim().min(1).max(20_000)
  })
]);

const assignSchema = z
  .object({
    action: z.literal("assign"),
    version: z.number().int().positive(),
    taskId: z.string().uuid().optional(),
    newTask: z
      .object({
        title: z.string().trim().min(1).max(200),
        description: z.string().max(20_000).optional(),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional()
      })
      .optional()
  })
  .refine((input) => Boolean(input.taskId) !== Boolean(input.newTask), {
    message: "Provide either taskId or newTask"
  });

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
      const input = assignSchema.parse(body);
      const payload = input.newTask ? { newTask: input.newTask } : { taskId: input.taskId! };
      return NextResponse.json({ data: await assignIssue(issueId, input.version, payload, actor) });
    }
    const input = lifecycleSchema.parse(body);
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
