import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export type Actor = { type: "USER" | "AI_TOOL"; label: string };

export function actorFromRequest(request: NextRequest): Actor | null {
  const toolToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const expected = process.env.AI_TOOL_TOKEN;

  if (toolToken && expected) {
    const a = Buffer.from(toolToken);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { type: "AI_TOOL", label: request.headers.get("x-spore-actor") ?? "AI tool" };
    }
  }

  // Local interactive UI boundary. Replace with host identity/session validation
  // before exposing the server beyond localhost.
  if (process.env.NODE_ENV === "development" || process.env.LOCAL_UI_ENABLED === "true") {
    return { type: "USER", label: "Local user" };
  }
  return null;
}
