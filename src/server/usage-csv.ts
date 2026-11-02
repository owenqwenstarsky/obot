/** Pure CSV serialization for usage exports. */

const CSV_HEADER = [
  "created_at",
  "user_email",
  "kind",
  "model",
  "effort",
  "input_tokens",
  "cached_input_tokens",
  "cache_write_tokens",
  "output_tokens",
  "reasoning_tokens",
  "total_tokens",
  "web_search_calls",
  "cost_usd",
  "priced",
  "thread_id",
  "note",
];

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function usageCsv(rows: {
  createdAt: string;
  userEmail: string;
  kind: string;
  modelId: string;
  effort: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  webSearchCalls: number;
  costMicros: number;
  priced: boolean;
  threadId: string | null;
  note: string | null;
}[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.createdAt,
        r.userEmail,
        r.kind,
        r.modelId,
        r.effort,
        r.inputTokens,
        r.cachedInputTokens,
        r.cacheWriteTokens,
        r.outputTokens,
        r.reasoningTokens,
        r.totalTokens,
        r.webSearchCalls,
        (r.costMicros / 1_000_000).toFixed(6),
        r.priced,
        r.threadId,
        r.note,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}
