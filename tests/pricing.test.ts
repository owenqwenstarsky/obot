import { describe, expect, it } from "vitest";
import { computeCost, pickActivePrice, type PriceInput } from "@/server/billing/pricing";
import { dollarsToMicros, formatUsd } from "@/lib/money";

const sol: PriceInput = {
  inputPerMMicros: dollarsToMicros(2),
  cachedInputPerMMicros: dollarsToMicros(0.1),
  cacheWritePerMMicros: dollarsToMicros(2.5),
  outputPerMMicros: dollarsToMicros(10),
  webSearchPer1kMicros: dollarsToMicros(10),
  longContextThreshold: 272_000,
  longContextInputMult: 2,
  longContextOutputMult: 1.5,
};

const usage = (input: number, cached: number, output: number, cacheWrite = 0) => ({
  inputTokens: input,
  cachedInputTokens: cached,
  cacheWriteTokens: cacheWrite,
  outputTokens: output,
});

describe("computeCost", () => {
  it("splits cached and uncached input", () => {
    // 800k uncached... keep below threshold: 200k input, 50k cached, 10k output
    const c = computeCost(usage(200_000, 50_000, 10_000), 0, sol);
    expect(c.inputMicros).toBe(300_000n); // 150k * $2/M = $0.30
    expect(c.cachedInputMicros).toBe(5_000n); // 50k * $0.10/M = $0.005
    expect(c.outputMicros).toBe(100_000n); // 10k * $10/M = $0.10
    expect(c.totalMicros).toBe(405_000n);
    expect(c.longContextApplied).toBe(false);
  });

  it("bills cache writes separately when a cache-write rate exists", () => {
    const c = computeCost(usage(100_000, 20_000, 0, 30_000), 0, sol);
    expect(c.inputMicros).toBe(100_000n); // 50k uncached * $2/M
    expect(c.cachedInputMicros).toBe(2_000n);
    expect(c.cacheWriteMicros).toBe(75_000n); // 30k * $2.5/M
  });

  it("treats cache writes as normal input when no cache-write rate is set", () => {
    const c = computeCost(usage(100_000, 20_000, 0, 30_000), 0, { ...sol, cacheWritePerMMicros: null });
    expect(c.cacheWriteMicros).toBe(0n);
    expect(c.inputMicros).toBe(160_000n); // 80k * $2/M
  });

  it("charges per web search call", () => {
    const c = computeCost(usage(0, 0, 0), 3, sol);
    expect(c.webSearchMicros).toBe(30_000n); // 3 * $10/1000
    expect(c.totalMicros).toBe(30_000n);
  });

  it("applies long-context multipliers to the whole request only above the threshold", () => {
    const at = computeCost(usage(272_000, 0, 1_000), 0, sol);
    expect(at.longContextApplied).toBe(false);
    expect(at.inputMicros).toBe(544_000n);

    const over = computeCost(usage(272_001, 1, 1_000), 0, sol);
    expect(over.longContextApplied).toBe(true);
    expect(over.inputMicros).toBe(1_088_000n); // 272000 * $2/M * 2
    expect(over.cachedInputMicros).toBe(0n); // 1 * 0.1/M * 2 = 0.2 micros -> rounds to 0
    expect(over.outputMicros).toBe(15_000n); // 1000 * $10/M * 1.5
  });

  it("rounds to the nearest micro-dollar and never goes negative", () => {
    const tiny = computeCost(usage(1, 0, 1), 0, sol);
    expect(tiny.inputMicros).toBe(2n);
    expect(tiny.outputMicros).toBe(10n);
    const weird = computeCost(usage(-5, 10, -1), -2, sol);
    expect(weird.totalMicros).toBe(0n);
  });

  it("handles sub-micro prices (Luna) with rounding", () => {
    const luna: PriceInput = { ...sol, inputPerMMicros: dollarsToMicros(0.1), cachedInputPerMMicros: dollarsToMicros(0.01), outputPerMMicros: dollarsToMicros(0.5), cacheWritePerMMicros: null };
    const c = computeCost(usage(1_234, 0, 567), 0, luna);
    expect(c.inputMicros).toBe(123n); // 123.4 -> 123
    expect(c.outputMicros).toBe(284n); // 283.5 -> 284
  });
});

describe("pickActivePrice", () => {
  it("chooses the newest price effective at the given time", () => {
    const prices = [
      { id: "a", effectiveFrom: new Date("2026-01-01") },
      { id: "b", effectiveFrom: new Date("2026-06-01") },
      { id: "c", effectiveFrom: new Date("2027-01-01") },
    ];
    expect(pickActivePrice(prices, new Date("2026-07-01"))?.id).toBe("b");
    expect(pickActivePrice(prices, new Date("2025-12-31"))).toBeNull();
  });
});

describe("money", () => {
  it("formats small amounts with more precision", () => {
    expect(formatUsd(1_500_000)).toBe("$1.50");
    expect(formatUsd(4_050)).toBe("$0.0041");
    expect(formatUsd(0)).toBe("$0.00");
  });
});
