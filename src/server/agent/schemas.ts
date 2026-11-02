import { z } from "zod";

export const turnOptionsSchema = z.object({
  modelId: z.string().min(1, "Pick a model."),
  effort: z.string().max(20).nullish(),
  webSearch: z.boolean().default(false),
});

export const sendSchema = turnOptionsSchema.extend({
  text: z.string().max(200_000).default(""),
  attachmentIds: z.array(z.string().max(64)).max(5).default([]),
});

export const editSchema = turnOptionsSchema.extend({
  text: z.string().max(200_000),
});
