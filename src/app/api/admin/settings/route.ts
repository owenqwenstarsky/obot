import { z } from "zod";
import { db } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { dollarsToMicros } from "@/lib/money";
import { normalizeDomains } from "@/server/llm/request-builder";
import { handler, json, parseBody } from "@/server/http";

function serialize(s: Awaited<ReturnType<typeof getSettings>>) {
  return {
    defaultLimitMode: s.defaultLimitMode,
    defaultWeeklyLimitMicros: s.defaultWeeklyLimitMicros != null ? Number(s.defaultWeeklyLimitMicros) : null,
    defaultMonthlyLimitMicros: s.defaultMonthlyLimitMicros != null ? Number(s.defaultMonthlyLimitMicros) : null,
    unpricedModelPolicy: s.unpricedModelPolicy,
    webSearchDefault: s.webSearchDefault,
    webSearchContextSize: s.webSearchContextSize,
    webSearchAllowedDomains: s.webSearchAllowedDomains,
    titleModelId: s.titleModelId,
    titleEffort: s.titleEffort,
    systemPrompt: s.systemPrompt,
    agentMaxSteps: s.agentMaxSteps,
    sandboxEnabled: s.sandboxEnabled,
    sandboxPythonEnabled: s.sandboxPythonEnabled,
    modelsSyncedAt: s.modelsSyncedAt?.toISOString() ?? null,
  };
}

export const GET = handler(async (req: Request) => {
  await requireAdmin(req);
  return json({ settings: serialize(await getSettings()) });
});

const money = z.number().nonnegative().max(1_000_000).nullable();
const schema = z.object({
  defaultLimitMode: z.enum(["LIMITED", "UNLIMITED"]).optional(),
  defaultWeeklyLimit: money.optional(),
  defaultMonthlyLimit: money.optional(),
  unpricedModelPolicy: z.enum(["BLOCK_LIMITED", "FREE"]).optional(),
  webSearchDefault: z.boolean().optional(),
  webSearchContextSize: z.enum(["low", "medium", "high"]).optional(),
  webSearchAllowedDomains: z.array(z.string().max(253)).max(100).optional(),
  titleModelId: z.string().max(200).nullable().optional(),
  titleEffort: z.string().max(20).nullable().optional(),
  systemPrompt: z.string().max(20_000).nullable().optional(),
  agentMaxSteps: z.number().int().min(1).max(200).optional(),
  sandboxEnabled: z.boolean().optional(),
  sandboxPythonEnabled: z.boolean().optional(),
});

export const PATCH = handler(async (req: Request) => {
  await requireAdmin(req);
  const body = await parseBody(req, schema);
  await getSettings();
  const { defaultWeeklyLimit, defaultMonthlyLimit, webSearchAllowedDomains, ...rest } = body;
  const updated = await db.appSettings.update({
    where: { id: "global" },
    data: {
      ...rest,
      ...(defaultWeeklyLimit !== undefined
        ? { defaultWeeklyLimitMicros: defaultWeeklyLimit == null ? null : dollarsToMicros(defaultWeeklyLimit) }
        : {}),
      ...(defaultMonthlyLimit !== undefined
        ? { defaultMonthlyLimitMicros: defaultMonthlyLimit == null ? null : dollarsToMicros(defaultMonthlyLimit) }
        : {}),
      ...(webSearchAllowedDomains ? { webSearchAllowedDomains: normalizeDomains(webSearchAllowedDomains) } : {}),
    },
  });
  return json({ settings: serialize(updated) });
});
