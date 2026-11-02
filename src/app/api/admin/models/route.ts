import { db } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { getAllCatalogModels } from "@/server/llm/models";
import { getSettings } from "@/server/settings";
import { handler, json } from "@/server/http";

export const GET = handler(async (req: Request) => {
  await requireAdmin(req);
  const [models, settings, latest] = await Promise.all([
    getAllCatalogModels(),
    getSettings(),
    db.modelPrice.findMany({ orderBy: { effectiveFrom: "desc" }, distinct: ["modelId"] }),
  ]);
  const priceByModel = new Map(latest.map((p) => [p.modelId, p]));
  return json({
    syncedAt: settings.modelsSyncedAt?.toISOString() ?? null,
    models: models.map((m) => {
      const p = priceByModel.get(m.id);
      return {
        ...m,
        price: p
          ? {
              id: p.id,
              effectiveFrom: p.effectiveFrom.toISOString(),
              inputPerMMicros: Number(p.inputPerMMicros),
              cachedInputPerMMicros: Number(p.cachedInputPerMMicros),
              cacheWritePerMMicros: p.cacheWritePerMMicros != null ? Number(p.cacheWritePerMMicros) : null,
              outputPerMMicros: Number(p.outputPerMMicros),
              webSearchPer1kMicros: Number(p.webSearchPer1kMicros),
              longContextThreshold: p.longContextThreshold,
              longContextInputMult: p.longContextInputMult,
              longContextOutputMult: p.longContextOutputMult,
            }
          : null,
      };
    }),
  });
});
