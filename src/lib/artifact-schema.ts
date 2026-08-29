import { z } from "zod";

/**
 * Artifacts are metadata-only references; binary upload is a shared future
 * slice. The field schemas are the shared bounds — the HTTP routes and the MCP
 * tools (including flat arg-bag inputs like attach_spore_context) both derive
 * from them, so a bound changes in exactly one place.
 */
export const artifactTitleSchema = z.string().trim().min(1).max(160);
export const artifactUrlSchema = z.string().url().max(2_000);
export const artifactTextSchema = z.string().min(1).max(100_000);
export const artifactFileNameSchema = z.string().trim().min(1).max(255);
export const artifactMimeTypeSchema = z.enum(["text/plain", "text/markdown", "application/pdf", "image/png", "image/jpeg", "image/webp"]);
export const artifactSizeBytesSchema = z.number().int().positive().max(25 * 1024 * 1024);

export const artifactInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("LINK"), title: artifactTitleSchema,
    url: artifactUrlSchema.refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Only HTTP(S) links are allowed")
  }),
  z.object({
    kind: z.literal("TEXT"), title: artifactTitleSchema,
    textContent: artifactTextSchema
  }),
  z.object({
    kind: z.literal("FILE_METADATA"), title: artifactTitleSchema,
    fileName: artifactFileNameSchema,
    mimeType: artifactMimeTypeSchema,
    sizeBytes: artifactSizeBytesSchema
  })
]);

export type ArtifactInput = z.infer<typeof artifactInputSchema>;
