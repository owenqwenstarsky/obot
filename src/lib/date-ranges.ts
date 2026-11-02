/** Date range presets for the usage page, computed in the viewer's local timezone. */

export type RangePreset =
  | "today"
  | "this_week"
  | "this_month"
  | "last_month"
  | "last_7"
  | "last_30"
  | "last_90"
  | "ytd"
  | "all"
  | "custom";

export const PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today",
  this_week: "This week",
  this_month: "This month",
  last_month: "Last month",
  last_7: "Last 7 days",
  last_30: "Last 30 days",
  last_90: "Last 90 days",
  ytd: "Year to date",
  all: "All time",
  custom: "Custom",
};

export type DateRange = { from: Date | null; to: Date | null };

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Returns a half-open [from, to) range. `null` means unbounded. */
export function presetRange(preset: Exclude<RangePreset, "custom">, now = new Date()): DateRange {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  switch (preset) {
    case "today":
      return { from: today, to: tomorrow };
    case "this_week": {
      const sinceMonday = (today.getDay() + 6) % 7;
      return { from: addDays(today, -sinceMonday), to: tomorrow };
    }
    case "this_month":
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: tomorrow };
    case "last_month":
      return {
        from: new Date(today.getFullYear(), today.getMonth() - 1, 1),
        to: new Date(today.getFullYear(), today.getMonth(), 1),
      };
    case "last_7":
      return { from: addDays(today, -6), to: tomorrow };
    case "last_30":
      return { from: addDays(today, -29), to: tomorrow };
    case "last_90":
      return { from: addDays(today, -89), to: tomorrow };
    case "ytd":
      return { from: new Date(today.getFullYear(), 0, 1), to: tomorrow };
    case "all":
      return { from: null, to: null };
  }
}

/** Custom inclusive day range [a, b] → half-open [startOfDay(a), startOfDay(b)+1). */
export function customRange(a: Date, b: Date): DateRange {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return { from: startOfDay(lo), to: addDays(startOfDay(hi), 1) };
}

export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Every local day key in [from, to), capped to avoid huge charts. */
export function daysBetween(from: Date, to: Date, cap = 400): string[] {
  const out: string[] = [];
  for (let d = startOfDay(from); d < to && out.length < cap; d = addDays(d, 1)) out.push(dayKey(d));
  return out;
}
