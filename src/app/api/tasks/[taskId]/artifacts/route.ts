import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { createArtifact } from "@/lib/workspace-service";

const schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("LINK"), title: z.string().trim().min(1).max(160),
    url: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Only HTTP(S) links are allowed")
  }),
  z.object({
    kind: z.literal("TEXT"), title: z.string().trim().min(1).max(160),
    textContent: z.string().min(1).max(100_000)
  }),
  z.object({
    kind: z.literal("FILE_METADATA"), title: z.string().trim().min(1).max(160),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum(["text/plain", "text/markdown", "application/pdf", "image/png", "image/jpeg", "image/webp"]),
    sizeBytes: z.number().int().positive().max(25 * 1024 * 1024)
  })
]);
export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const actor = actorFromRequest(request);
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ data: await createArtifact({ taskId: (await params).taskId, ...schema.parse(await request.json()) }, actor) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
