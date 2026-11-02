/** Reasoning effort handling. The app never exposes anything above `xhigh`. */

export const ALL_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof ALL_EFFORTS)[number];

/** Efforts the app is willing to send, in ascending order. `max` is intentionally excluded. */
export const ALLOWED_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
export type AllowedEffort = (typeof ALLOWED_EFFORTS)[number];

export const EFFORT_LABELS: Record<AllowedEffort, string> = {
  none: "Disabled",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
};

export const GENERIC_EFFORTS: AllowedEffort[] = ["low", "medium", "high", "xhigh"];

export function isAllowedEffort(value: unknown): value is AllowedEffort {
  return typeof value === "string" && (ALLOWED_EFFORTS as readonly string[]).includes(value);
}

/** Drop unknown values and anything above `xhigh`, keep ascending order, dedupe. */
export function capEfforts(efforts: readonly string[]): AllowedEffort[] {
  const set = new Set(efforts);
  return ALLOWED_EFFORTS.filter((e) => set.has(e));
}

/** Pick a valid effort for a model: the requested one if allowed, else the default, else the middle. */
export function resolveEffort(
  requested: string | null | undefined,
  allowed: readonly AllowedEffort[],
  fallback?: AllowedEffort,
): AllowedEffort | null {
  if (allowed.length === 0) return null;
  if (requested && (allowed as readonly string[]).includes(requested)) return requested as AllowedEffort;
  if (fallback && allowed.includes(fallback)) return fallback;
  if (allowed.includes("medium")) return "medium";
  return allowed[Math.floor(allowed.length / 2)];
}

export function effortLabel(effort: string | null | undefined): string {
  if (!effort) return "Default";
  return isAllowedEffort(effort) ? EFFORT_LABELS[effort] : effort;
}
