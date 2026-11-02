/**
 * Model metadata for known models served through CLIProxyAPI.
 *
 * Source: OpenAI developer model pages (developers.openai.com/api/docs/models/*), verified 2026-11-02.
 *
 * IMPORTANT: `referencePricing` is informational only and is NEVER used for billing.
 * Spend is computed from API-reported token usage multiplied by the admin-managed
 * price table (ModelPrice) in the database.
 *
 * Reasoning efforts are capped at `xhigh` by product decision even though the models also
 * accept `max`.
 */
import { z } from "zod";
import { ALLOWED_EFFORTS } from "@/lib/efforts";

const effortSchema = z.enum(ALLOWED_EFFORTS);

export const modelMetadataSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    family: z.string().min(1),
    description: z.string().min(1),
    contextWindow: z.number().int().positive(),
    maxInputTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    knowledgeCutoff: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    inputModalities: z.array(z.enum(["text", "image", "audio", "video"])).min(1),
    outputModalities: z.array(z.enum(["text", "image", "audio"])).min(1),
    reasoningEfforts: z.array(effortSchema).min(1),
    defaultEffort: effortSchema,
    supportsWebSearch: z.boolean(),
    supportsImageInput: z.boolean(),
    referencePricing: z.object({
      note: z.literal("Informational only. Never used for billing."),
      currency: z.literal("USD"),
      unit: z.literal("per 1M tokens"),
      input: z.number().nonnegative(),
      cachedInput: z.number().nonnegative(),
      cacheWrite: z.number().nonnegative(),
      output: z.number().nonnegative(),
    }),
    longContextNote: z.string(),
    longContextThresholdTokens: z.number().int().positive(),
    sourceUrl: z.string().url(),
    verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((m) => m.reasoningEfforts.includes(m.defaultEffort), {
    message: "defaultEffort must be one of reasoningEfforts",
  })
  .refine((m) => m.maxInputTokens <= m.contextWindow && m.maxOutputTokens <= m.contextWindow, {
    message: "max input/output must fit in the context window",
  });

export type ModelMetadata = z.infer<typeof modelMetadataSchema>;

const LONG_CONTEXT_NOTE =
  "Prompts over 272K input tokens are billed by OpenAI at 2x input/cache rates and 1.5x output for the whole request.";

const rawMetadata: ModelMetadata[] = [
  {
    id: "gpt-6.1-sol",
    displayName: "GPT-6.1 Sol",
    family: "GPT-6",
    description: "Frontier GPT-6.1 model for complex reasoning, coding, and agentic work.",
    contextWindow: 1_050_000,
    maxInputTokens: 922_000,
    maxOutputTokens: 128_000,
    knowledgeCutoff: "2026-04-30",
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
    supportsWebSearch: true,
    supportsImageInput: true,
    referencePricing: {
      note: "Informational only. Never used for billing.",
      currency: "USD",
      unit: "per 1M tokens",
      input: 2,
      cachedInput: 0.1,
      cacheWrite: 2.5,
      output: 10,
    },
    longContextNote: LONG_CONTEXT_NOTE,
    longContextThresholdTokens: 272_000,
    sourceUrl: "https://developers.openai.com/api/docs/models/gpt-6.1-sol",
    verifiedAt: "2026-11-02",
  },
  {
    id: "gpt-6-astra",
    displayName: "GPT-6 Astra",
    family: "GPT-6",
    description: "Largest GPT-6 model for the hardest problems where quality matters most.",
    contextWindow: 1_050_000,
    maxInputTokens: 922_000,
    maxOutputTokens: 128_000,
    knowledgeCutoff: "2026-04-30",
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
    supportsWebSearch: true,
    supportsImageInput: true,
    referencePricing: {
      note: "Informational only. Never used for billing.",
      currency: "USD",
      unit: "per 1M tokens",
      input: 10,
      cachedInput: 1,
      cacheWrite: 12.5,
      output: 50,
    },
    longContextNote: LONG_CONTEXT_NOTE,
    longContextThresholdTokens: 272_000,
    sourceUrl: "https://developers.openai.com/api/docs/models/gpt-6-astra",
    verifiedAt: "2026-11-02",
  },
  {
    id: "gpt-6-luna",
    displayName: "GPT-6 Luna",
    family: "GPT-6",
    description: "Fast, low-cost GPT-6 model for everyday tasks. Reasoning can be disabled.",
    contextWindow: 1_050_000,
    maxInputTokens: 922_000,
    maxOutputTokens: 128_000,
    knowledgeCutoff: "2026-05-18",
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
    supportsWebSearch: true,
    supportsImageInput: true,
    referencePricing: {
      note: "Informational only. Never used for billing.",
      currency: "USD",
      unit: "per 1M tokens",
      input: 0.1,
      cachedInput: 0.01,
      cacheWrite: 0.125,
      output: 0.5,
    },
    longContextNote: LONG_CONTEXT_NOTE,
    longContextThresholdTokens: 272_000,
    sourceUrl: "https://developers.openai.com/api/docs/models/gpt-6-luna",
    verifiedAt: "2026-11-02",
  },
];

export const MODEL_METADATA: readonly ModelMetadata[] = Object.freeze(
  z.array(modelMetadataSchema).parse(rawMetadata),
);

const byId = new Map(MODEL_METADATA.map((m) => [m.id, m]));

export function getModelMetadata(id: string): ModelMetadata | undefined {
  return byId.get(id);
}
