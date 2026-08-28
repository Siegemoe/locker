import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { artifactInputSchema } from "@/lib/artifact-schema";
import { createIssue, listIssues } from "@/lib/issue-service";

const createSchema = z.object({
  projectId: z.string().uuid().optional(),
  kind: z.enum(["BUG", "REGRESSION", "DEBT"]).optional(),
  title: z.string().trim().min(1).max(200),
  details: z.string().max(20_000).optional(),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
  reportedBy: z.string().trim().min(1).max(120).optional(),
  sourceCandidateId: z.string().uuid().optional(),
  attachments: z.array(artifactInputSchema).max(10).optional()
});

const querySchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.enum(["OPEN", "TRIAGED", "RESOLVED", "CLOSED"]).optional(),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
  kind: z.enum(["BUG", "REGRESSION", "DEBT"]).optional(),
  assignedTaskId: z.string().uuid().optional(),
  unassigned: z.enum(["true"]).optional(),
  limit: z.coerce.number().int().positive().max(200).optional()
});

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { workspaceId } = await context.params;
    const query = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json({
      data: await listIssues(workspaceId, { ...query, unassignedOnly: query.unassigned === "true" })
    });
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
    const issue = await createIssue({ workspaceId, ...input }, actor);
    return NextResponse.json({ data: issue }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
