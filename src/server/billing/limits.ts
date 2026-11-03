/** Pure spend-limit logic: windows (UTC), limit resolution, and enforcement decisions. */

export type LimitModeValue = "INHERIT" | "CUSTOM" | "UNLIMITED";
export type DefaultLimitModeValue = "LIMITED" | "UNLIMITED";
export type UnpricedPolicyValue = "BLOCK_LIMITED" | "FREE";

export type UserLimitConfig = {
  limitMode: LimitModeValue;
  weeklyLimitMicros: bigint | null;
  monthlyLimitMicros: bigint | null;
};

export type DefaultLimitConfig = {
  defaultLimitMode: DefaultLimitModeValue;
  defaultWeeklyLimitMicros: bigint | null;
  defaultMonthlyLimitMicros: bigint | null;
};

export type ResolvedLimits = {
  /** True when no cap applies at all. */
  unlimited: boolean;
  weekly: bigint | null;
  monthly: bigint | null;
  source: "user" | "default";
};

export type Window = { start: Date; end: Date };

/** Week runs Monday 00:00 UTC → next Monday 00:00 UTC. */
export function weekWindow(now: Date): Window {
  const day = now.getUTCDay(); // 0 = Sunday
  const sinceMonday = (day + 6) % 7;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceMonday));
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Month runs the 1st 00:00 UTC → the 1st of next month 00:00 UTC. */
export function monthWindow(now: Date): Window {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

export function resolveLimits(user: UserLimitConfig, defaults: DefaultLimitConfig): ResolvedLimits {
  if (user.limitMode === "UNLIMITED") {
    return { unlimited: true, weekly: null, monthly: null, source: "user" };
  }
  if (user.limitMode === "CUSTOM") {
    const weekly = user.weeklyLimitMicros;
    const monthly = user.monthlyLimitMicros;
    return { unlimited: weekly == null && monthly == null, weekly, monthly, source: "user" };
  }
  if (defaults.defaultLimitMode === "UNLIMITED") {
    return { unlimited: true, weekly: null, monthly: null, source: "default" };
  }
  const weekly = defaults.defaultWeeklyLimitMicros;
  const monthly = defaults.defaultMonthlyLimitMicros;
  return { unlimited: weekly == null && monthly == null, weekly, monthly, source: "default" };
}

export type SpendInWindows = { weekly: bigint; monthly: bigint };

export type LimitDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "WEEKLY_LIMIT" | "MONTHLY_LIMIT" | "UNPRICED_MODEL";
      message: string;
      resetsAt?: Date;
    };

export function evaluateSpend(limits: ResolvedLimits, spent: SpendInWindows, now: Date): LimitDecision {
  if (limits.unlimited) return { allowed: true };
  if (limits.monthly != null && spent.monthly >= limits.monthly) {
    const resetsAt = monthWindow(now).end;
    return {
      allowed: false,
      code: "MONTHLY_LIMIT",
      message: "You've reached your monthly spend limit.",
      resetsAt,
    };
  }
  if (limits.weekly != null && spent.weekly >= limits.weekly) {
    const resetsAt = weekWindow(now).end;
    return {
      allowed: false,
      code: "WEEKLY_LIMIT",
      message: "You've reached your weekly spend limit.",
      resetsAt,
    };
  }
  return { allowed: true };
}

export function evaluateUnpriced(
  policy: UnpricedPolicyValue,
  limits: ResolvedLimits,
  modelHasPrice: boolean,
): LimitDecision {
  if (modelHasPrice || policy === "FREE" || limits.unlimited) return { allowed: true };
  return {
    allowed: false,
    code: "UNPRICED_MODEL",
    message: "This model has no price configured yet, so it isn't available on a limited plan. Ask an admin to set a price.",
  };
}

export type SpendAlertLevel = "warning" | "reached";
export const SPEND_WARNING_RATIO = 0.8;

/** Alert level for a window: ≥80% of the cap warns, ≥100% means the cap is reached. Null when uncapped. */
export function spendAlertLevel(spent: bigint | number, limit: bigint | number | null): SpendAlertLevel | null {
  if (limit == null) return null;
  const s = Number(spent);
  const l = Number(limit);
  if (l <= 0) return s >= 0 ? "reached" : null;
  if (s >= l) return "reached";
  if (s >= l * SPEND_WARNING_RATIO) return "warning";
  return null;
}
