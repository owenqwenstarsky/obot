import { describe, expect, it } from "vitest";
import {
  evaluateSpend,
  evaluateUnpriced,
  monthWindow,
  resolveLimits,
  weekWindow,
  type DefaultLimitConfig,
} from "@/server/billing/limits";

const iso = (d: Date) => d.toISOString();

describe("windows (UTC)", () => {
  it("weeks start Monday 00:00 UTC", () => {
    // Sunday 2026-11-01 23:59:59Z belongs to the week of Monday 2026-10-26.
    const sun = weekWindow(new Date("2026-11-01T23:59:59.999Z"));
    expect(iso(sun.start)).toBe("2026-10-26T00:00:00.000Z");
    expect(iso(sun.end)).toBe("2026-11-02T00:00:00.000Z");
    // Monday 00:00 starts a new week.
    const mon = weekWindow(new Date("2026-11-02T00:00:00.000Z"));
    expect(iso(mon.start)).toBe("2026-11-02T00:00:00.000Z");
    expect(iso(mon.end)).toBe("2026-11-09T00:00:00.000Z");
  });

  it("weeks spanning a month/year boundary", () => {
    const w = weekWindow(new Date("2027-01-01T12:00:00Z")); // Friday
    expect(iso(w.start)).toBe("2026-12-28T00:00:00.000Z");
  });

  it("months start on the 1st UTC and handle rollover and leap years", () => {
    const dec = monthWindow(new Date("2026-12-31T23:59:59Z"));
    expect(iso(dec.start)).toBe("2026-12-01T00:00:00.000Z");
    expect(iso(dec.end)).toBe("2027-01-01T00:00:00.000Z");
    const feb = monthWindow(new Date("2028-02-29T10:00:00Z"));
    expect(iso(feb.start)).toBe("2028-02-01T00:00:00.000Z");
    expect(iso(feb.end)).toBe("2028-03-01T00:00:00.000Z");
  });
});

const limitedDefaults: DefaultLimitConfig = {
  defaultLimitMode: "LIMITED",
  defaultWeeklyLimitMicros: 5_000_000n,
  defaultMonthlyLimitMicros: 15_000_000n,
};
const unlimitedDefaults: DefaultLimitConfig = { ...limitedDefaults, defaultLimitMode: "UNLIMITED" };

describe("resolveLimits", () => {
  it("INHERIT follows instance defaults", () => {
    const u = { limitMode: "INHERIT" as const, weeklyLimitMicros: 1n, monthlyLimitMicros: 1n };
    expect(resolveLimits(u, limitedDefaults)).toEqual({ unlimited: false, weekly: 5_000_000n, monthly: 15_000_000n, source: "default" });
    expect(resolveLimits(u, unlimitedDefaults).unlimited).toBe(true);
  });

  it("CUSTOM uses the user's caps; null means no cap for that period", () => {
    const r = resolveLimits({ limitMode: "CUSTOM", weeklyLimitMicros: null, monthlyLimitMicros: 2n }, unlimitedDefaults);
    expect(r).toEqual({ unlimited: false, weekly: null, monthly: 2n, source: "user" });
    expect(resolveLimits({ limitMode: "CUSTOM", weeklyLimitMicros: null, monthlyLimitMicros: null }, limitedDefaults).unlimited).toBe(true);
  });

  it("UNLIMITED overrides limited defaults", () => {
    expect(resolveLimits({ limitMode: "UNLIMITED", weeklyLimitMicros: 1n, monthlyLimitMicros: 1n }, limitedDefaults).unlimited).toBe(true);
  });

  it("LIMITED defaults with no amounts are effectively unlimited", () => {
    const r = resolveLimits(
      { limitMode: "INHERIT", weeklyLimitMicros: null, monthlyLimitMicros: null },
      { defaultLimitMode: "LIMITED", defaultWeeklyLimitMicros: null, defaultMonthlyLimitMicros: null },
    );
    expect(r.unlimited).toBe(true);
  });
});

describe("evaluateSpend", () => {
  const now = new Date("2026-11-04T10:00:00Z");
  const limits = resolveLimits({ limitMode: "INHERIT", weeklyLimitMicros: null, monthlyLimitMicros: null }, limitedDefaults);

  it("allows spend under both caps", () => {
    expect(evaluateSpend(limits, { weekly: 4_999_999n, monthly: 4_999_999n }, now)).toEqual({ allowed: true });
  });

  it("blocks when the weekly cap is reached (>=) with the next Monday as reset", () => {
    const d = evaluateSpend(limits, { weekly: 5_000_000n, monthly: 5_000_000n }, now);
    expect(d).toMatchObject({ allowed: false, code: "WEEKLY_LIMIT" });
    if (d.allowed) throw new Error();
    expect(iso(d.resetsAt!)).toBe("2026-11-09T00:00:00.000Z");
  });

  it("monthly cap takes precedence when both are hit", () => {
    const d = evaluateSpend(limits, { weekly: 9_000_000n, monthly: 15_000_000n }, now);
    expect(d).toMatchObject({ allowed: false, code: "MONTHLY_LIMIT" });
    if (d.allowed) throw new Error();
    expect(iso(d.resetsAt!)).toBe("2026-12-01T00:00:00.000Z");
  });

  it("never blocks unlimited users", () => {
    const u = resolveLimits({ limitMode: "UNLIMITED", weeklyLimitMicros: null, monthlyLimitMicros: null }, limitedDefaults);
    expect(evaluateSpend(u, { weekly: 10n ** 12n, monthly: 10n ** 12n }, now).allowed).toBe(true);
  });
});

describe("evaluateUnpriced", () => {
  const limited = resolveLimits({ limitMode: "INHERIT", weeklyLimitMicros: null, monthlyLimitMicros: null }, limitedDefaults);
  const unlimited = resolveLimits({ limitMode: "UNLIMITED", weeklyLimitMicros: null, monthlyLimitMicros: null }, limitedDefaults);

  it("BLOCK_LIMITED blocks unpriced models for limited users only", () => {
    expect(evaluateUnpriced("BLOCK_LIMITED", limited, false)).toMatchObject({ allowed: false, code: "UNPRICED_MODEL" });
    expect(evaluateUnpriced("BLOCK_LIMITED", unlimited, false).allowed).toBe(true);
    expect(evaluateUnpriced("BLOCK_LIMITED", limited, true).allowed).toBe(true);
  });

  it("FREE allows unpriced models for everyone", () => {
    expect(evaluateUnpriced("FREE", limited, false).allowed).toBe(true);
  });
});

describe("spendAlertLevel", () => {
  it("warns at 80% and reports reaching the cap", async () => {
    const { spendAlertLevel } = await import("@/server/billing/limits");
    expect(spendAlertLevel(0n, null)).toBeNull();
    expect(spendAlertLevel(79n, 100n)).toBeNull();
    expect(spendAlertLevel(80n, 100n)).toBe("warning");
    expect(spendAlertLevel(99, 100)).toBe("warning");
    expect(spendAlertLevel(100n, 100n)).toBe("reached");
    expect(spendAlertLevel(150, 100)).toBe("reached");
    expect(spendAlertLevel(0n, 0n)).toBe("reached");
  });

  it("only notifies when the level rises within a period", async () => {
    const { shouldNotify, alertStorageKey } = await import("@/lib/spend-alerts");
    expect(shouldNotify(null, null)).toBe(false);
    expect(shouldNotify(null, "warning")).toBe(true);
    expect(shouldNotify("warning", "warning")).toBe(false);
    expect(shouldNotify("warning", "reached")).toBe(true);
    expect(shouldNotify("reached", "warning")).toBe(false);
    expect(alertStorageKey("weekly", "2026-11-09T00:00:00.000Z")).toBe("obot:spend-alert:weekly:2026-11-09T00:00:00.000Z");
  });
});
