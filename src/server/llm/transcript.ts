/**
 * The model-facing transcript of an assistant turn: the exact Responses API input items
 * (assistant text, function calls + outputs, steering messages, task notifications) that
 * a multi-step run produced. Stored in `Message.rawOutput` as `{ v: 2, items }` so later
 * turns can replay tool use faithfully. Parts remain the UI view.
 *
 * Pure functions only.
 */

export type InputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "auto" };

export type FunctionCallItem = { type: "function_call"; call_id: string; name: string; arguments: string };
export type FunctionCallOutputItem = { type: "function_call_output"; call_id: string; output: string };
export type ReasoningInputItem = {
  type: "reasoning";
  id: string;
  summary: { type: "summary_text"; text: string }[];
  encrypted_content: string;
};

export type InputItem =
  | { role: "user"; content: InputContent[] }
  | { role: "assistant"; content: string }
  | FunctionCallItem
  | FunctionCallOutputItem
  | ReasoningInputItem;

export type TranscriptItem = InputItem;
export type StoredTranscript = { v: 2; items: TranscriptItem[] };

/** Max size of a single tool output kept in the stored transcript. */
export const STORE_OUTPUT_CAP = 100_000;
/** Max size of a tool output when replaying a past turn. */
export const REPLAY_PAST_OUTPUT_CAP = 8_000;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function isStoredTranscript(v: unknown): v is StoredTranscript {
  const o = obj(v);
  return !!o && o.v === 2 && Array.isArray(o.items);
}

/** Keep the head and tail of a long string, eliding the middle. */
export function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.6);
  const tail = Math.max(0, max - head);
  const omitted = s.length - head - tail;
  return `${s.slice(0, head)}\n…[${omitted} characters omitted]…\n${s.slice(s.length - tail)}`;
}

/**
 * Convert raw Responses output items from one model call into transcript items.
 * Unknown/hosted items (web_search_call, …) are dropped: their effect is already in the text.
 */
export function outputItemsToTranscript(raw: unknown[], opts: { keepReasoning: boolean }): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  for (const r of raw) {
    const item = obj(r);
    if (!item) continue;
    const type = str(item.type);
    if (type === "message") {
      let text = "";
      for (const c of Array.isArray(item.content) ? item.content : []) {
        const co = obj(c);
        if (!co) continue;
        if (co.type === "output_text") text += str(co.text) ?? "";
        else if (co.type === "refusal") text += str(co.refusal) ?? "";
      }
      if (text) out.push({ role: "assistant", content: text });
    } else if (type === "function_call") {
      const callId = str(item.call_id) ?? str(item.id);
      const name = str(item.name);
      if (!callId || !name) continue;
      out.push({ type: "function_call", call_id: callId, name, arguments: str(item.arguments) ?? "{}" });
    } else if (type === "reasoning" && opts.keepReasoning) {
      const id = str(item.id);
      const enc = str(item.encrypted_content);
      if (!id || !enc) continue;
      const summary = (Array.isArray(item.summary) ? item.summary : [])
        .map((s) => str(obj(s)?.text))
        .filter((t): t is string => !!t)
        .map((text) => ({ type: "summary_text" as const, text }));
      out.push({ type: "reasoning", id, summary, encrypted_content: enc });
    }
  }
  return out;
}

/** Drop function calls without outputs (and orphan outputs) so the transcript is always valid input. */
export function sanitizeForReplay(items: TranscriptItem[]): TranscriptItem[] {
  const calls = new Set<string>();
  const outputs = new Set<string>();
  for (const it of items) {
    if ("type" in it && it.type === "function_call") calls.add(it.call_id);
    if ("type" in it && it.type === "function_call_output") outputs.add(it.call_id);
  }
  const out = items.filter((it) => {
    if (!("type" in it)) return true;
    if (it.type === "function_call") return outputs.has(it.call_id);
    if (it.type === "function_call_output") return calls.has(it.call_id);
    return true;
  });
  // A reasoning item must be followed by the item it produced; drop trailing reasoning.
  while (out.length > 0) {
    const last = out[out.length - 1];
    if ("type" in last && last.type === "reasoning") out.pop();
    else break;
  }
  return out;
}

/**
 * Items to send for a stored transcript. Past turns drop reasoning (the API ignores it after a
 * new user message anyway) and truncate large tool outputs.
 */
export function replayTranscript(items: TranscriptItem[], o: { pastTurn: boolean }): TranscriptItem[] {
  const clean = sanitizeForReplay(items);
  if (!o.pastTurn) return clean;
  const out: TranscriptItem[] = [];
  for (const it of clean) {
    if ("type" in it && it.type === "reasoning") continue;
    if ("type" in it && it.type === "function_call_output") {
      out.push({ ...it, output: truncateMiddle(it.output, REPLAY_PAST_OUTPUT_CAP) });
      continue;
    }
    out.push(it);
  }
  return out;
}

export function steerItem(text: string): TranscriptItem {
  return { role: "user", content: [{ type: "input_text", text }] };
}

export type TaskNotification = {
  taskId: string;
  title: string;
  status: "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED";
  result: string | null;
  error: string | null;
};

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** A system-authored user item telling the orchestrator a sub-agent finished. */
export function taskNotificationItem(tasks: TaskNotification[], stillRunning: number): TranscriptItem {
  const blocks = tasks.map((t) => {
    const body =
      t.status === "COMPLETED"
        ? truncateMiddle(t.result?.trim() || "(The sub-agent finished without a final message.)", 16_000)
        : [t.error ? `Error: ${t.error}` : null, t.result ? `Partial output:\n${truncateMiddle(t.result, 8_000)}` : null]
            .filter(Boolean)
            .join("\n\n") || "(no output)";
    return `<task_notification task_id="${escapeAttr(t.taskId)}" title="${escapeAttr(t.title)}" status="${t.status.toLowerCase()}">\n${body}\n</task_notification>`;
  });
  const tail =
    stillRunning > 0
      ? `Review the result${tasks.length > 1 ? "s" : ""}, briefly acknowledge ${tasks.length > 1 ? "them" : "it"} to the user, and continue. ${stillRunning} other sub-agent task${stillRunning === 1 ? " is" : "s are"} still running; the runtime keeps waiting for ${stillRunning === 1 ? "it" : "them"} automatically, so do not poll.`
      : "Review the result and continue. No other sub-agent tasks are running.";
  return {
    role: "user",
    content: [{ type: "input_text", text: `[System notification — not written by the user]\n${blocks.join("\n\n")}\n\n${tail}` }],
  };
}
