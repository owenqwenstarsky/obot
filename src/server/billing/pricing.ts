/**
 * Pure cost computation. Inputs are API-reported token counts; prices come from the
 * admin-managed ModelPrice table. All math is integer BigInt to avoid float drift.
 */
import type { UsageSnapshot } from "@/lib/parts";

export type PriceInput = {
  id?: string;
  inputPerMMicros: bigint;
  cachedInputPerMMicros: bigint;
  cacheWritePerMMicros: bigint | null;
  outputPerMMicros: bigint;
  webSearchPer1kMicros: bigint;
  longContextThreshold: number | null;
  longContextInputMult: number | null;
  longContextOutputMult: number | null;
};

export type CostBreakdown = {
  totalMicros: bigint;
  inputMicros: bigint;
  cachedInputMicros: bigint;
  cacheWriteMicros: bigint;
  outputMicros: bigint;
  webSearchMicros: bigint;
  longContextApplied: boolean;
};

const TOKENS_PER_UNIT = 1_000_000n; // prices are per 1M tokens
const MULT_SCALE = 1000n; // multipliers are applied with 3 decimal places of precision

function toMilli(mult: number | null | undefined): bigint {
  if (mult == null || !Number.isFinite(mult) || mult <= 0) return MULT_SCALE;
  return BigInt(Math.round(mult * Number(MULT_SCALE)));
}

/** Round-half-up integer division for non-negative values. */
function divRound(numerator: bigint, denominator: bigint): bigint {
  if (numerator <= 0n) return 0n;
  return (numerator + denominator / 2n) / denominator;
}

function nonNeg(n: number): bigint {
  return BigInt(Math.max(0, Math.floor(n || 0)));
}

export function computeCost(
  usage: Pick<UsageSnapshot, "inputTokens" | "cachedInputTokens" | "cacheWriteTokens" | "outputTokens">,
  webSearchCalls: number,
  price: PriceInput,
): CostBreakdown {
  const input = nonNeg(usage.inputTokens);
  const cached = minBig(nonNeg(usage.cachedInputTokens), input);
  const hasCacheWriteRate = price.cacheWritePerMMicros != null;
  const cacheWrite = hasCacheWriteRate ? minBig(nonNeg(usage.cacheWriteTokens), input - cached) : 0n;
  const uncached = input - cached - cacheWrite;
  const output = nonNeg(usage.outputTokens);

  const longContextApplied =
    price.longContextThreshold != null && Number(input) > price.longContextThreshold;
  const inMult = longContextApplied ? toMilli(price.longContextInputMult) : MULT_SCALE;
  const outMult = longContextApplied ? toMilli(price.longContextOutputMult) : MULT_SCALE;

  const denom = TOKENS_PER_UNIT * MULT_SCALE;
  const inputMicros = divRound(uncached * price.inputPerMMicros * inMult, denom);
  const cachedInputMicros = divRound(cached * price.cachedInputPerMMicros * inMult, denom);
  const cacheWriteMicros = hasCacheWriteRate
    ? divRound(cacheWrite * (price.cacheWritePerMMicros as bigint) * inMult, denom)
    : 0n;
  const outputMicros = divRound(output * price.outputPerMMicros * outMult, denom);
  const webSearchMicros = divRound(nonNeg(webSearchCalls) * price.webSearchPer1kMicros, 1000n);

  return {
    totalMicros: inputMicros + cachedInputMicros + cacheWriteMicros + outputMicros + webSearchMicros,
    inputMicros,
    cachedInputMicros,
    cacheWriteMicros,
    outputMicros,
    webSearchMicros,
    longContextApplied,
  };
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** Choose the price row active at `at`: the newest row with effectiveFrom <= at. */
export function pickActivePrice<T extends { effectiveFrom: Date }>(prices: T[], at: Date): T | null {
  let best: T | null = null;
  for (const p of prices) {
    if (p.effectiveFrom.getTime() <= at.getTime() && (!best || p.effectiveFrom > best.effectiveFrom)) {
      best = p;
    }
  }
  return best;
}
