import type { ActivityActorType } from "@prisma/client";

/**
 * Who performed a mutation, as the services see it. The adapter-side
 * counterpart in auth.ts is request-bound and can never be SYSTEM.
 */
export type TaskActor = { type: ActivityActorType; label: string };
