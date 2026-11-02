/** Money helpers. All amounts are integer micro-dollars (1 USD = 1_000_000). */

export const MICROS_PER_DOLLAR = 1_000_000;

export function dollarsToMicros(dollars: number): bigint {
  if (!Number.isFinite(dollars) || dollars < 0) throw new Error("Invalid dollar amount");
  return BigInt(Math.round(dollars * MICROS_PER_DOLLAR));
}

export function microsToDollars(micros: bigint | number | string): number {
  return Number(micros) / MICROS_PER_DOLLAR;
}

export function formatUsd(micros: bigint | number | string, opts: { precise?: boolean } = {}): string {
  const dollars = microsToDollars(micros);
  const abs = Math.abs(dollars);
  let digits = 2;
  if (opts.precise || (abs > 0 && abs < 0.01)) digits = abs < 0.0001 && abs > 0 ? 6 : 4;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(dollars);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(n);
}
