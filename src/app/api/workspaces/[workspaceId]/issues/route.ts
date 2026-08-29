import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { issueCreateInputSchema, issueFilterInputSchema } from "@/lib/issue-schema";
import { createIssue, listIssues } from "@/lib/issue-service";

// Query params arrive as strings, so the transport coerces the two numeric
// flags and maps `unassigned` onto the contract's unassignedOnly filter.
const querySchema = issueFilterInputSchema
  .omit({ unassignedOnly: true, limit: true })
  .extend({
    unassigned: z.enum(["true"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional()
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
    const input = issueCreateInputSchema.parse(await request.json());
    const issue = await createIssue({ workspaceId, ...input }, actor);
    return NextResponse.json({ data: issue }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
