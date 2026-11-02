import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { getSelectableModels } from "@/server/llm/models";
import { getSettings } from "@/server/settings";
import { handler, json } from "@/server/http";

export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const [models, settings, prefs] = await Promise.all([
    getSelectableModels(),
    getSettings(),
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { webSearchDefault: true, defaultModelId: true, defaultEffort: true },
    }),
  ]);
  // Only an explicit, still-selectable preference counts; the client falls back to last-used.
  const defaultModel = models.find((m) => m.id === prefs.defaultModelId) ?? null;
  return json({
    models,
    defaults: {
      modelId: defaultModel?.id ?? null,
      effort: prefs.defaultEffort,
      webSearch: prefs.webSearchDefault ?? settings.webSearchDefault,
    },
  });
});
