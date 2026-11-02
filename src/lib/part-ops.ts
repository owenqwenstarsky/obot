/** Incremental operations on a parts array. Shared by the server normalizer and the client. */
import type { MessagePart } from "./parts";

export type PartOp =
  | { op: "upsert"; index: number; part: MessagePart }
  | { op: "append_text"; index: number; delta: string }
  | { op: "append_reasoning"; index: number; delta: string };

/** Returns a new array (parts that change are shallow-copied) so React can diff it. */
export function applyPartOps(parts: MessagePart[], ops: PartOp[]): MessagePart[] {
  if (ops.length === 0) return parts;
  const next = parts.slice();
  for (const op of ops) {
    if (op.op === "upsert") {
      next[op.index] = op.part;
      continue;
    }
    const existing = next[op.index];
    if (op.op === "append_text" && existing?.type === "text") {
      next[op.index] = { ...existing, text: existing.text + op.delta };
    } else if (op.op === "append_reasoning" && existing?.type === "reasoning") {
      next[op.index] = { ...existing, summary: existing.summary + op.delta };
    }
  }
  return next;
}
