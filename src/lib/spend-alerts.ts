/** Client-safe spend alert helpers (re-exports the pure server logic). */
export { spendAlertLevel, SPEND_WARNING_RATIO, type SpendAlertLevel } from "@/server/billing/limits";
import type { SpendAlertLevel } from "@/server/billing/limits";

const RANK: Record<SpendAlertLevel, number> = { warning: 1, reached: 2 };

/** Whether moving from `seen` to `level` should notify (only when the level rises). */
export function shouldNotify(seen: SpendAlertLevel | null, level: SpendAlertLevel | null): boolean {
  if (!level) return false;
  return !seen || RANK[level] > RANK[seen];
}

/** localStorage key: one entry per window period, so each week/month alerts afresh. */
export function alertStorageKey(window: "weekly" | "monthly", resetsAt: string): string {
  return `obot:spend-alert:${window}:${resetsAt}`;
}
