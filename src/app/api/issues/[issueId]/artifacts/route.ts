import { NextRequest, NextResponse } from "next/server";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { artifactInputSchema } from "@/lib/artifact-schema";
import { createArtifact } from "@/lib/workspace-service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ issueId: string }> }) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(
      { data: await createArtifact({ issueId: (await params).issueId, ...artifactInputSchema.parse(await request.json()) }, actor) },
      { status: 201 }
    );
  } catch (error) {
    return apiError(error);
  }
}
