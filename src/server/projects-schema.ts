import { z } from "zod";

/** Editable project fields shared by the create and update routes. */
export const projectFields = {
  description: z.string().max(2000).nullable().optional(),
  instructions: z.string().max(20_000).nullable().optional(),
  defaultModelId: z.string().max(200).nullable().optional(),
  defaultEffort: z.string().max(20).nullable().optional(),
  webSearchDefault: z.boolean().nullable().optional(),
};
