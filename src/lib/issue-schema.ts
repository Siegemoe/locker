import { IssueCloseReason, IssueKind, IssueSeverity, IssueStatus, TaskPriority } from "@prisma/client";
import { z } from "zod";
import { artifactInputSchema } from "@/lib/artifact-schema";

/**
 * Input contracts for issue operations, shared by the HTTP routes and the MCP
 * tools. Lifecycle and assign payloads are separate shapes so the adapters can
 * frame action and version around them: HTTP discriminates on `action` in the
 * body, MCP tools carry `id` and frame the action in the tool name.
 */
export const issueCreateInputSchema = z.object({
  projectId: z.string().uuid().optional(),
  kind: z.enum(IssueKind).optional(),
  title: z.string().trim().min(1).max(200),
  details: z.string().max(20_000).optional(),
  severity: z.enum(IssueSeverity).optional(),
  reportedBy: z.string().trim().min(1).max(120).optional(),
  sourceCandidateId: z.string().uuid().optional(),
  attachments: z.array(artifactInputSchema).max(10).optional()
});
export type IssueCreateInput = z.infer<typeof issueCreateInputSchema>;

export const issueUpdateInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  details: z.string().max(20_000).nullable().optional(),
  kind: z.enum(IssueKind).optional(),
  severity: z.enum(IssueSeverity).optional(),
  projectId: z.string().uuid().optional(),
  duplicateOfId: z.string().uuid().nullable().optional()
});
export type IssueUpdatePatch = z.infer<typeof issueUpdateInputSchema>;

export const issueFilterInputSchema = z.object({
  status: z.enum(IssueStatus).optional(),
  severity: z.enum(IssueSeverity).optional(),
  kind: z.enum(IssueKind).optional(),
  projectId: z.string().uuid().optional(),
  assignedTaskId: z.string().uuid().optional(),
  unassignedOnly: z.boolean().optional(),
  query: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(200).optional()
});

export const issueTriagePayloadSchema = z.object({
  severity: z.enum(IssueSeverity).optional()
});

export const issueResolvePayloadSchema = z.object({
  closeReason: z.enum(IssueCloseReason).optional(),
  note: z.string().trim().max(20_000).optional(),
  duplicateOfId: z.string().uuid().optional()
});

export const issueReopenPayloadSchema = z.object({
  note: z.string().trim().min(1).max(20_000)
});

export const issueLifecycleInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("triage"), version: z.number().int().positive() }).extend(issueTriagePayloadSchema.shape),
  z.object({ action: z.literal("resolve"), version: z.number().int().positive() }).extend(issueResolvePayloadSchema.shape),
  z.object({ action: z.literal("verify"), version: z.number().int().positive() }),
  z.object({ action: z.literal("reopen"), version: z.number().int().positive() }).extend(issueReopenPayloadSchema.shape)
]);

export const issueAssignInputSchema = z.object({
  version: z.number().int().positive(),
  taskId: z.string().uuid().optional(),
  newTask: z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(20_000).optional(),
    priority: z.enum(TaskPriority).optional()
  }).optional()
});
/**
 * Assignment needs exactly one target. The bare shape exists for MCP raw-shape
 * input schemas, which cannot carry a refinement; callers that need the rule
 * enforced parse through issueAssignSchema.
 */
export const issueAssignSchema = issueAssignInputSchema.refine(
  (input) => Boolean(input.taskId) !== Boolean(input.newTask),
  { message: "Provide either taskId or newTask" }
);
