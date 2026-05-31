import { z } from "zod";

export const AttachmentKindSchema = z.enum(["IMAGE", "DOCUMENT", "SPREADSHEET", "TEXT", "OTHER"]);

export const AttachmentMaterialSchema = z.object({
  summary: z.string().max(1800),
  keyFacts: z.array(z.string().max(180)).max(12).default([]),
  entities: z.array(z.string().max(120)).max(12).default([]),
  visualNotes: z.array(z.string().max(180)).max(12).default([]),
  tables: z
    .array(
      z.object({
        name: z.string().max(120),
        columns: z.array(z.string().max(80)).max(24).default([]),
        sampleRows: z.array(z.string().max(220)).max(8).default([]),
        notes: z.array(z.string().max(160)).max(8).default([]),
      }),
    )
    .max(8)
    .default([]),
  promptHints: z.array(z.string().max(220)).max(14).default([]),
  warnings: z.array(z.string().max(180)).max(10).default([]),
});

export type AttachmentKind = z.infer<typeof AttachmentKindSchema>;
export type AttachmentMaterial = z.infer<typeof AttachmentMaterialSchema>;

export type RuntimeSkillInput = {
  name: string;
  mimeType: string;
  kind: AttachmentKind;
  text?: string;
  tables?: AttachmentMaterial["tables"];
  imageUrl?: string | null;
  size: number;
  model?: string;
};

export type RuntimeSkill = {
  name: string;
  version: string;
  inputKinds: AttachmentKind[];
  run(input: RuntimeSkillInput): Promise<AttachmentMaterial>;
};
