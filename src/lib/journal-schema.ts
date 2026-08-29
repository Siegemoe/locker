import { JournalCandidateKind, JournalRole } from "@prisma/client";
import { z } from "zod";

/**
 * Input contracts for Journal operations, shared by the HTTP routes and the
 * MCP tools. HTTP requires the entry date in the body; the MCP tools default
 * it to today, so those tools extend the shared shape with an optional date.
 */
export const journalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const journalContributionInputSchema = z.object({
  date: journalDateSchema,
  authorKey: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/i),
  authorLabel: z.string().trim().min(1).max(120),
  modelId: z.string().trim().max(160).nullable().optional(),
  role: z.enum(JournalRole).optional(),
  bodyMarkdown: z.string().trim().min(1).max(100_000),
  topics: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  importance: z.number().int().min(1).max(5).optional(),
  sourceReferences: z.array(z.string().trim().min(1).max(2_000)).max(50).optional(),
  projectIds: z.array(z.string().uuid()).max(50).optional(),
  candidateIds: z.array(z.string().uuid()).max(100).optional(),
  version: z.number().int().positive().optional()
});
export type JournalContributionInput = z.infer<typeof journalContributionInputSchema>;

export const journalCandidateInputSchema = z.object({
  date: journalDateSchema,
  authorKey: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/i),
  authorLabel: z.string().trim().min(1).max(120),
  modelId: z.string().trim().max(160).nullable().optional(),
  kind: z.enum(JournalCandidateKind),
  summary: z.string().trim().min(1).max(2_000),
  contextMarkdown: z.string().trim().max(20_000).nullable().optional(),
  importance: z.number().int().min(1).max(5).optional(),
  sourceReferences: z.array(z.string().trim().min(1).max(2_000)).max(50).optional(),
  projectId: z.string().uuid().nullable().optional()
});
export type JournalCandidateInput = z.infer<typeof journalCandidateInputSchema>;

export const journalSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  dateFrom: journalDateSchema.optional(),
  dateTo: journalDateSchema.optional(),
  authorKey: z.string().trim().max(80).optional(),
  topic: z.string().trim().max(80).optional(),
  projectId: z.string().uuid().optional(),
  minImportance: z.number().int().min(1).max(5).optional(),
  limit: z.number().int().min(1).max(100).optional()
});
