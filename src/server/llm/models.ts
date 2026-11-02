import "server-only";
import { db } from "@/server/db";
import { fetchUpstreamModels } from "@/server/llm/client";
import { sortCatalog, toCatalogModel, type CatalogModel } from "@/server/llm/catalog";
import { getSettings } from "@/server/settings";

const SYNC_INTERVAL_MS = 10 * 60 * 1000;
let inflight: Promise<SyncResult> | null = null;

export type SyncResult = { ok: true; total: number; added: number } | { ok: false; error: string };

export async function syncModels(): Promise<SyncResult> {
  if (inflight) return inflight;
  inflight = (async (): Promise<SyncResult> => {
    try {
      const upstream = await fetchUpstreamModels();
      const now = new Date();
      const existing = await db.model.findMany({ select: { id: true } });
      const existingIds = new Set(existing.map((m) => m.id));
      const seen = new Set<string>();
      let added = 0;
      for (const m of upstream) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        if (!existingIds.has(m.id)) added++;
        await db.model.upsert({
          where: { id: m.id },
          create: { id: m.id, ownedBy: m.owned_by ?? null, available: true, lastSeenAt: now },
          update: { ownedBy: m.owned_by ?? null, available: true, lastSeenAt: now },
        });
      }
      await db.model.updateMany({ where: { id: { notIn: [...seen] } }, data: { available: false } });
      await db.appSettings.upsert({
        where: { id: "global" },
        update: { modelsSyncedAt: now },
        create: { id: "global", modelsSyncedAt: now },
      });
      return { ok: true, total: seen.size, added };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Kick off a background sync if the catalog is stale. Never throws. */
export async function maybeSyncModels(): Promise<void> {
  try {
    const settings = await getSettings();
    const last = settings.modelsSyncedAt?.getTime() ?? 0;
    if (Date.now() - last > SYNC_INTERVAL_MS) void syncModels();
  } catch {
    // ignore
  }
}

async function pricedModelIds(): Promise<Set<string>> {
  const rows = await db.modelPrice.findMany({
    where: { effectiveFrom: { lte: new Date() } },
    select: { modelId: true },
    distinct: ["modelId"],
  });
  return new Set(rows.map((r) => r.modelId));
}

export async function getAllCatalogModels(): Promise<CatalogModel[]> {
  const [rows, priced] = await Promise.all([db.model.findMany(), pricedModelIds()]);
  return sortCatalog(rows.map((r) => toCatalogModel(r, priced.has(r.id))));
}

/** Models a user may pick: enabled by an admin and present in the latest upstream sync. */
export async function getSelectableModels(): Promise<CatalogModel[]> {
  void maybeSyncModels();
  const [rows, priced] = await Promise.all([
    db.model.findMany({ where: { enabled: true, available: true } }),
    pricedModelIds(),
  ]);
  return sortCatalog(rows.map((r) => toCatalogModel(r, priced.has(r.id))));
}

export async function getSelectableModel(id: string): Promise<CatalogModel | null> {
  const row = await db.model.findFirst({ where: { id, enabled: true, available: true } });
  if (!row) return null;
  const priced = await db.modelPrice.findFirst({
    where: { modelId: id, effectiveFrom: { lte: new Date() } },
    select: { id: true },
  });
  return toCatalogModel(row, !!priced);
}
