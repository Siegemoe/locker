import { NextRequest, NextResponse } from "next/server";
import { actorFromRequest } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    if (!actorFromRequest(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const workspace = await db.workspace.findUniqueOrThrow({
      where: { slug: "spore-locker" },
      select: {
        id: true, slug: true, name: true,
        projects: { orderBy: [{ archivedAt: "asc" }, { name: "asc" }] },
        tags: { where: { archivedAt: null }, orderBy: { name: "asc" } }
      }
    });
    return NextResponse.json({ data: workspace });
  } catch (error) {
    return apiError(error);
  }
}
