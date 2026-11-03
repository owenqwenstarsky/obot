/**
 * Converts raw Responses API streaming events into normalized MessageParts.
 * Pure and deterministic (time is injected), so it can be unit-tested with fixtures.
 *
 * Events are typed loosely on purpose: CLIProxyAPI may forward events from different
 * upstreams, so unknown events or missing fields must never crash a run.
 */
import type {
  Citation,
  FunctionToolPart,
  GenericToolPart,
  MessagePart,
  ReasoningPart,
  TextPart,
  UsageSnapshot,
  WebSearchAction,
  WebSearchPart,
  WebSearchStatus,
} from "@/lib/parts";
import type { PartOp } from "@/lib/part-ops";

type Json = Record<string, unknown>;

export type StreamEvent = { type: string } & Json;

export type NormalizerStatus = "running" | "completed" | "incomplete" | "failed";

export type NormalizerSnapshot = {
  parts: MessagePart[];
  rawOutput: unknown[];
  usage: UsageSnapshot | null;
  responseId: string | null;
  status: NormalizerStatus;
  error: string | null;
  incompleteReason: string | null;
  /** Billable web searches: web_search_call items whose action is a `search`. */
  webSearchCalls: number;
  /** Completed function calls from this response, in output order. */
  functionCalls: PendingFunctionCall[];
  /** Index of the first part created by this normalizer (parts before it belong to earlier steps). */
  stepPartStart: number;
};

export type PendingFunctionCall = {
  itemId: string;
  callId: string;
  name: string;
  arguments: string;
  partIndex: number;
};

export type NormalizerOptions = {
  /** Shared parts array (multi-step runs). New parts are appended; earlier parts are never touched. */
  parts?: MessagePart[];
  /** Prefix for part ids so ids stay unique across steps. */
  idPrefix?: string;
};

const WEB_STATUSES: WebSearchStatus[] = ["in_progress", "searching", "completed", "failed", "incomplete"];

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function obj(v: unknown): Json | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function parseUsage(raw: unknown): UsageSnapshot | null {
  const u = obj(raw);
  if (!u) return null;
  const inputDetails = obj(u.input_tokens_details) ?? {};
  const outputDetails = obj(u.output_tokens_details) ?? {};
  const inputTokens = num(u.input_tokens);
  const outputTokens = num(u.output_tokens);
  return {
    inputTokens,
    cachedInputTokens: num(inputDetails.cached_tokens),
    cacheWriteTokens: num(inputDetails.cache_write_tokens),
    outputTokens,
    reasoningTokens: num(outputDetails.reasoning_tokens),
    totalTokens: num(u.total_tokens) || inputTokens + outputTokens,
  };
}

export function parseWebSearchAction(raw: unknown): WebSearchAction | null {
  const a = obj(raw);
  if (!a) return null;
  const type = str(a.type);
  if (type === "search") {
    const queries = arr(a.queries).filter((q): q is string => typeof q === "string");
    const query = str(a.query);
    if (query && !queries.includes(query)) queries.unshift(query);
    return { kind: "search", queries };
  }
  if (type === "open_page") return { kind: "open_page", url: str(a.url) };
  if (type === "find_in_page" || type === "find") {
    return { kind: "find_in_page", url: str(a.url), pattern: str(a.pattern) };
  }
  return null;
}

function parseSources(action: unknown): { url: string; title?: string }[] {
  const a = obj(action);
  if (!a) return [];
  const out: { url: string; title?: string }[] = [];
  for (const s of arr(a.sources)) {
    const so = obj(s);
    const url = so && str(so.url);
    if (url) out.push({ url, title: str(so.title) });
  }
  return out;
}

function parseCitation(raw: unknown): Citation | null {
  const a = obj(raw);
  if (!a || str(a.type) !== "url_citation") return null;
  const url = str(a.url);
  if (!url) return null;
  return { url, title: str(a.title), start: num(a.start_index), end: num(a.end_index) };
}

export class ResponseStreamNormalizer {
  private parts: MessagePart[];
  private readonly idPrefix: string;
  private readonly stepPartStart: number;
  private functionCalls = new Map<string, PendingFunctionCall>();
  private indexByItemId = new Map<string, number>();
  private summaryIndexByItem = new Map<string, number>();
  private rawOutput: unknown[] = [];
  private usage: UsageSnapshot | null = null;
  private responseId: string | null = null;
  private status: NormalizerStatus = "running";
  private error: string | null = null;
  private incompleteReason: string | null = null;
  private countedSearchItems = new Set<string>();

  constructor(
    private readonly now: () => number = Date.now,
    opts: NormalizerOptions = {},
  ) {
    this.parts = opts.parts ?? [];
    this.idPrefix = opts.idPrefix ?? "";
    this.stepPartStart = this.parts.length;
  }

  snapshot(): NormalizerSnapshot {
    return {
      parts: this.parts.slice(),
      rawOutput: this.rawOutput.slice(),
      usage: this.usage,
      responseId: this.responseId,
      status: this.status,
      error: this.error,
      incompleteReason: this.incompleteReason,
      webSearchCalls: this.countedSearchItems.size,
      functionCalls: [...this.functionCalls.values()],
      stepPartStart: this.stepPartStart,
    };
  }

  /** Feed one event; returns the part operations to forward to clients. */
  apply(event: StreamEvent): PartOp[] {
    try {
      return this.handle(event);
    } catch {
      // Never let a malformed event kill the run.
      return [];
    }
  }

  /**
   * Mark any open reasoning/tool parts from this step as finished (called when the stream ends).
   * Function calls whose arguments never finished streaming are cancelled; completed calls
   * (`pending`) are left for the caller to execute or cancel.
   */
  finalizeOpenParts(): PartOp[] {
    const ops: PartOp[] = [];
    const t = this.now();
    for (let index = this.stepPartStart; index < this.parts.length; index++) {
      const p = this.parts[index];
      if (p.type === "reasoning" && p.endedAt == null) {
        ops.push(this.set(index, { ...p, endedAt: t }));
      } else if (p.type === "tool" && p.tool === "web_search" && (p.status === "in_progress" || p.status === "searching")) {
        ops.push(this.set(index, { ...p, status: "incomplete", endedAt: t }));
      } else if (p.type === "tool" && p.tool === "function" && p.status === "streaming_args") {
        ops.push(this.set(index, { ...p, status: "cancelled", endedAt: t }));
      }
    }
    return ops;
  }

  private set(index: number, part: MessagePart): PartOp {
    this.parts[index] = part;
    return { op: "upsert", index, part };
  }

  private add(itemId: string, raw: MessagePart): { index: number; op: PartOp } {
    const index = this.parts.length;
    const part = this.idPrefix ? ({ ...raw, id: `${this.idPrefix}${raw.id}` } as MessagePart) : raw;
    this.parts.push(part);
    this.indexByItemId.set(itemId, index);
    return { index, op: { op: "upsert", index, part } };
  }

  private closeOpenReasoning(): PartOp[] {
    const ops: PartOp[] = [];
    const t = this.now();
    for (let index = this.stepPartStart; index < this.parts.length; index++) {
      const p = this.parts[index];
      if (p.type === "reasoning" && p.endedAt == null) ops.push(this.set(index, { ...p, endedAt: t }));
    }
    return ops;
  }

  private ensureText(itemId: string): number {
    const existing = this.indexByItemId.get(itemId);
    if (existing != null && this.parts[existing]?.type === "text") return existing;
    const part: TextPart = { type: "text", id: itemId, text: "", citations: [] };
    return this.add(itemId, part).index;
  }

  private ensureReasoning(itemId: string): { index: number; created: PartOp | null } {
    const existing = this.indexByItemId.get(itemId);
    if (existing != null && this.parts[existing]?.type === "reasoning") return { index: existing, created: null };
    const part: ReasoningPart = { type: "reasoning", id: itemId, summary: "", startedAt: this.now() };
    const { index, op } = this.add(itemId, part);
    return { index, created: op };
  }

  private handle(event: StreamEvent): PartOp[] {
    switch (event.type) {
      case "response.created":
      case "response.in_progress":
      case "response.queued": {
        const r = obj(event.response);
        if (r && str(r.id)) this.responseId = str(r.id)!;
        return [];
      }

      case "response.output_item.added":
        return this.onItemAdded(obj(event.item));

      case "response.output_item.done":
        return this.onItemDone(obj(event.item));

      case "response.output_text.delta": {
        const itemId = str(event.item_id);
        const delta = str(event.delta);
        if (!itemId || !delta) return [];
        const created = !this.indexByItemId.has(itemId);
        const index = this.ensureText(itemId);
        const ops: PartOp[] = [];
        if (created) ops.push(...this.closeOpenReasoning(), { op: "upsert", index, part: this.parts[index] });
        const part = this.parts[index] as TextPart;
        this.parts[index] = { ...part, text: part.text + delta };
        ops.push({ op: "append_text", index, delta });
        return ops;
      }

      case "response.output_text.annotation.added": {
        const itemId = str(event.item_id);
        const citation = parseCitation(event.annotation);
        if (!itemId || !citation) return [];
        const index = this.ensureText(itemId);
        const part = this.parts[index] as TextPart;
        if (part.citations.some((c) => c.url === citation.url && c.start === citation.start)) return [];
        return [this.set(index, { ...part, citations: [...part.citations, citation] })];
      }

      case "response.output_text.done": {
        const itemId = str(event.item_id);
        const text = str(event.text);
        if (!itemId || text == null) return [];
        const index = this.ensureText(itemId);
        const part = this.parts[index] as TextPart;
        if (part.text === text) return [];
        return [this.set(index, { ...part, text })];
      }

      case "response.refusal.delta": {
        const itemId = str(event.item_id);
        const delta = str(event.delta);
        if (!itemId || !delta) return [];
        const index = this.ensureText(itemId);
        const part = this.parts[index] as TextPart;
        this.parts[index] = { ...part, text: part.text + delta };
        return [{ op: "append_text", index, delta }];
      }

      case "response.reasoning_summary_text.delta": {
        const itemId = str(event.item_id);
        const delta = str(event.delta);
        if (!itemId || delta == null) return [];
        const { index, created } = this.ensureReasoning(itemId);
        const ops: PartOp[] = created ? [created] : [];
        const summaryIndex = num(event.summary_index);
        const last = this.summaryIndexByItem.get(itemId);
        let text = delta;
        const part = this.parts[index] as ReasoningPart;
        if (last != null && summaryIndex !== last && part.summary.length > 0) text = `\n\n${delta}`;
        this.summaryIndexByItem.set(itemId, summaryIndex);
        this.parts[index] = { ...part, summary: part.summary + text };
        ops.push({ op: "append_reasoning", index, delta: text });
        return ops;
      }

      case "response.web_search_call.in_progress":
      case "response.web_search_call.searching":
      case "response.web_search_call.completed": {
        const itemId = str(event.item_id);
        if (!itemId) return [];
        const status = event.type.split(".").pop() as WebSearchStatus;
        let index = this.indexByItemId.get(itemId);
        const ops: PartOp[] = [];
        if (index == null) {
          ops.push(...this.closeOpenReasoning());
          const added = this.add(itemId, this.newWebSearch(itemId, status, null));
          index = added.index;
          ops.push(added.op);
          return ops;
        }
        const part = this.parts[index];
        if (part?.type !== "tool" || part.tool !== "web_search") return ops;
        ops.push(
          this.set(index, {
            ...part,
            status,
            endedAt: status === "completed" ? (part.endedAt ?? this.now()) : part.endedAt,
          }),
        );
        return ops;
      }

      case "response.function_call_arguments.delta": {
        const itemId = str(event.item_id);
        const delta = str(event.delta);
        if (!itemId || !delta) return [];
        const index = this.indexByItemId.get(itemId);
        const part = index != null ? this.parts[index] : undefined;
        if (index == null || part?.type !== "tool" || part.tool !== "function") return [];
        this.parts[index] = { ...part, argsText: part.argsText + delta };
        return [{ op: "append_args", index, delta }];
      }

      case "response.function_call_arguments.done": {
        const itemId = str(event.item_id);
        const args = str(event.arguments);
        if (!itemId || args == null) return [];
        const index = this.indexByItemId.get(itemId);
        const part = index != null ? this.parts[index] : undefined;
        if (index == null || part?.type !== "tool" || part.tool !== "function" || part.argsText === args) return [];
        return [this.set(index, { ...part, argsText: args })];
      }

      case "response.completed":
      case "response.incomplete":
      case "response.failed": {
        const r = obj(event.response) ?? {};
        if (str(r.id)) this.responseId = str(r.id)!;
        const usage = parseUsage(r.usage);
        if (usage) this.usage = usage;
        if (this.rawOutput.length === 0 && Array.isArray(r.output)) {
          // Some upstreams only send the final response; recover items from it.
          const ops: PartOp[] = [];
          for (const item of r.output) {
            ops.push(...this.onItemAdded(obj(item)), ...this.onItemDone(obj(item)));
          }
          this.finishStatus(event.type, r);
          return [...ops, ...this.closeOpenReasoning()];
        }
        this.finishStatus(event.type, r);
        return this.closeOpenReasoning();
      }

      case "error": {
        this.status = "failed";
        this.error = str(event.message) ?? str(obj(event.error)?.message) ?? "The model returned an error.";
        return this.finalizeOpenParts();
      }

      default:
        return [];
    }
  }

  private finishStatus(type: string, r: Json) {
    if (type === "response.completed") {
      this.status = "completed";
    } else if (type === "response.incomplete") {
      this.status = "incomplete";
      this.incompleteReason = str(obj(r.incomplete_details)?.reason) ?? null;
    } else {
      this.status = "failed";
      this.error = str(obj(r.error)?.message) ?? "The response failed.";
    }
  }

  private newWebSearch(id: string, status: WebSearchStatus, item: Json | null): WebSearchPart {
    const action = item ? parseWebSearchAction(item.action) : null;
    return {
      type: "tool",
      tool: "web_search",
      id,
      status,
      actions: action ? [action] : [],
      sources: item ? parseSources(item.action) : [],
      startedAt: this.now(),
    };
  }

  private onItemAdded(item: Json | undefined): PartOp[] {
    if (!item) return [];
    const id = str(item.id) ?? str(item.call_id) ?? `item_${this.parts.length}`;
    if (this.indexByItemId.has(id)) return [];
    const type = str(item.type) ?? "unknown";
    const ops: PartOp[] = [];

    if (type !== "reasoning") ops.push(...this.closeOpenReasoning());

    switch (type) {
      case "message": {
        const part: TextPart = { type: "text", id, text: "", citations: [] };
        ops.push(this.add(id, part).op);
        break;
      }
      case "reasoning": {
        const { created } = this.ensureReasoning(id);
        if (created) ops.push(created);
        break;
      }
      case "function_call": {
        const part: FunctionToolPart = {
          type: "tool",
          tool: "function",
          id,
          callId: str(item.call_id) ?? id,
          name: str(item.name) ?? "unknown",
          status: "streaming_args",
          argsText: str(item.arguments) ?? "",
          startedAt: this.now(),
        };
        ops.push(this.add(id, part).op);
        break;
      }
      case "web_search_call": {
        const raw = str(item.status);
        const status = (WEB_STATUSES as string[]).includes(raw ?? "") ? (raw as WebSearchStatus) : "in_progress";
        ops.push(this.add(id, this.newWebSearch(id, status, item)).op);
        break;
      }
      default: {
        const part: GenericToolPart = {
          type: "tool",
          tool: "generic",
          id,
          itemType: type,
          status: str(item.status) ?? "in_progress",
          raw: item,
        };
        ops.push(this.add(id, part).op);
      }
    }
    return ops;
  }

  private onItemDone(item: Json | undefined): PartOp[] {
    if (!item) return [];
    this.rawOutput.push(item);
    const id = str(item.id) ?? str(item.call_id);
    const type = str(item.type) ?? "unknown";
    if (!id) return [];
    let index = this.indexByItemId.get(id);
    const ops: PartOp[] = [];
    if (index == null) {
      ops.push(...this.onItemAdded(item));
      index = this.indexByItemId.get(id);
      if (index == null) return ops;
    }
    const part = this.parts[index];

    if (type === "message" && part?.type === "text") {
      let text = "";
      const citations: Citation[] = [];
      for (const c of arr(item.content)) {
        const co = obj(c);
        if (!co) continue;
        if (str(co.type) === "output_text") {
          const offset = text.length;
          text += str(co.text) ?? "";
          for (const a of arr(co.annotations)) {
            const cit = parseCitation(a);
            if (cit) citations.push({ ...cit, start: cit.start + offset, end: cit.end + offset });
          }
        } else if (str(co.type) === "refusal") {
          text += str(co.refusal) ?? "";
        }
      }
      const next: TextPart = {
        ...part,
        text: text || part.text,
        citations: citations.length > 0 ? citations : part.citations,
      };
      ops.push(this.set(index, next));
    } else if (type === "reasoning" && part?.type === "reasoning") {
      const summary = arr(item.summary)
        .map((s) => str(obj(s)?.text) ?? "")
        .filter(Boolean)
        .join("\n\n");
      ops.push(this.set(index, { ...part, summary: summary || part.summary, endedAt: part.endedAt ?? this.now() }));
    } else if (type === "web_search_call" && part?.type === "tool" && part.tool === "web_search") {
      const action = parseWebSearchAction(item.action);
      const raw = str(item.status);
      const status = (WEB_STATUSES as string[]).includes(raw ?? "") ? (raw as WebSearchStatus) : "completed";
      const sources = parseSources(item.action);
      const next: WebSearchPart = {
        ...part,
        status,
        actions: action ? [action] : part.actions,
        sources: sources.length > 0 ? sources : part.sources,
        endedAt: part.endedAt ?? this.now(),
      };
      if ((action?.kind ?? part.actions[0]?.kind) === "search") this.countedSearchItems.add(id);
      ops.push(this.set(index, next));
    } else if (type === "function_call" && part?.type === "tool" && part.tool === "function") {
      const args = str(item.arguments) ?? part.argsText;
      const callId = str(item.call_id) ?? part.callId;
      const name = str(item.name) ?? part.name;
      ops.push(this.set(index, { ...part, status: "pending", argsText: args, callId, name }));
      if (!this.functionCalls.has(id)) {
        this.functionCalls.set(id, { itemId: id, callId, name, arguments: args, partIndex: index });
      }
    } else if (part?.type === "tool" && part.tool === "generic") {
      ops.push(this.set(index, { ...part, status: str(item.status) ?? "completed", raw: item }));
    }
    return ops;
  }
}
