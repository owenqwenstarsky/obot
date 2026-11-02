import { MODEL_METADATA } from "@/config/model-metadata";

/**
 * Stable categorical colors for models. Known (metadata) models always own the same slot,
 * so their color never changes when a filter changes which models are present. Other
 * models take the remaining slots alphabetically; past eight series they fold into "Other".
 */
const META_ORDER = new Map(MODEL_METADATA.map((m, i) => [m.id, i]));

export const MAX_SERIES = 8;

export function orderModels(ids: string[]): string[] {
  return [...new Set(ids)].sort((a, b) => {
    const ia = META_ORDER.get(a);
    const ib = META_ORDER.get(b);
    if (ia != null || ib != null) return (ia ?? 99) - (ib ?? 99);
    return a.localeCompare(b);
  });
}

export type Series = { key: string; label: string; color: string; members: string[] };

export function assignSeries(ids: string[]): Series[] {
  const ordered = orderModels(ids);
  const used = new Set<number>();
  const slotted: { id: string; slot: number }[] = [];
  const rest: string[] = [];
  for (const id of ordered) {
    const fixed = META_ORDER.get(id);
    if (fixed != null && fixed < MAX_SERIES) {
      used.add(fixed);
      slotted.push({ id, slot: fixed });
    } else rest.push(id);
  }
  const free = Array.from({ length: MAX_SERIES }, (_, i) => i).filter((i) => !used.has(i));
  const needsOther = slotted.length + rest.length > MAX_SERIES;
  const room = needsOther ? free.length - 1 : free.length;
  rest.slice(0, room).forEach((id, i) => slotted.push({ id, slot: free[i] }));
  const overflow = rest.slice(room);

  const series: Series[] = slotted
    .sort((a, b) => a.slot - b.slot)
    .map(({ id, slot }) => ({ key: id, label: id, color: `var(--series-${slot + 1})`, members: [id] }));
  if (overflow.length > 0) {
    series.push({ key: "__other", label: "Other", color: "var(--series-other)", members: overflow });
  }
  return series;
}
