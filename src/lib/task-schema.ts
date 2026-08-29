import { DependencyType, TaskPriority, TaskStatus } from "@prisma/client";
import { z } from "zod";

/**
 * Input contracts for task operations, shared by the HTTP routes and the MCP
 * tools. Enums come from the Prisma client so a schema change cannot drift
 * from what the database enforces. Adapters frame the transport (id and
 * version in a URL or a tool arg) around these shapes.
 */
export const taskCreateInputSchema = z.object({
  projectId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional(),
  status: z.enum(TaskStatus).optional(),
  priority: z.enum(TaskPriority).optional(),
  tagIds: z.array(z.string().uuid()).max(20).optional()
});
export type TaskCreateInput = z.infer<typeof taskCreateInputSchema>;

/**
 * Capture is an intake operation, not a lifecycle shortcut. HTTP keeps the
 * broader create contract for trusted local imports, while AI capture cannot
 * choose a terminal state and must use submit_spore_completion for DONE.
 */
export const taskCaptureInputSchema = taskCreateInputSchema.omit({ status: true });

export const taskUpdateInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).nullable().optional(),
  status: z.enum(TaskStatus).optional(),
  priority: z.enum(TaskPriority).optional(),
  projectId: z.string().uuid().nullable().optional(),
  tagIds: z.array(z.string().uuid()).max(20).optional()
});
export type TaskUpdatePatch = z.infer<typeof taskUpdateInputSchema>;

export const taskDependencyPlanInputSchema = z.object({
  dependencies: z.array(z.object({
    taskId: z.string().uuid(),
    type: z.enum(DependencyType)
  })).max(100)
});
export type TaskDependencyPlan = z.infer<typeof taskDependencyPlanInputSchema>["dependencies"];
