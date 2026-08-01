import { NextRequest, NextResponse } from "next/server";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { archiveArtifact } from "@/lib/workspace-service";

export async function POST(request: NextRequest, { params }: { params: Promise<{ artifactId: string }> }) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ data: await archiveArtifact((await params).artifactId, actor) });
  } catch (error) { return apiError(error); }
}
