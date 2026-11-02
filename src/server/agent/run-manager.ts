/**
 * In-memory registry of live agent runs. Runs execute detached from HTTP requests;
 * clients subscribe via SSE and can re-attach at any time by replaying events after a
 * sequence number. All I/O is injected so this can be tested without a DB or network.
 */
import type { MessagePart, UsageSnapshot } from "@/lib/parts";
import { emptyUsage } from "@/lib/parts";
import type { RunEvent, RunEventInput, RunStatusValue, MessageStatusValue } from "@/lib/run-events";
import { ResponseStreamNormalizer, type StreamEvent } from "@/server/llm/stream-normalizer";

export type RunFinish = {
  runId: string;
  threadId: string;
  userId: string;
  messageId: string;
  modelId: string;
  effort: string | null;
  runStatus: RunStatusValue;
  messageStatus: MessageStatusValue;
  parts: MessagePart[];
  rawOutput: unknown[];
  error: string | null;
  responseId: string | null;
  usage: UsageSnapshot | null;
  webSearchCalls: number;
};

export type RunManagerDeps = {
  /** Opens the upstream Responses stream. */
  openStream: (body: unknown, signal: AbortSignal) => Promise<AsyncIterable<StreamEvent>>;
  /** Persist in-progress parts (throttled). */
  saveParts: (messageId: string, parts: MessagePart[]) => Promise<void>;
  /** Persist final state + usage. Returns the recorded cost in micro-dollars. */
  finish: (result: RunFinish) => Promise<{ costMicros: number }>;
  now?: () => number;
  flushIntervalMs?: number;
  /** How long finished runs stay replayable in memory. */
  retainMs?: number;
  log?: (msg: string, err?: unknown) => void;
};

export type StartRunParams = {
  runId: string;
  threadId: string;
  userId: string;
  messageId: string;
  modelId: string;
  effort: string | null;
  body: unknown;
};

type Listener = (event: RunEvent) => void;

type LiveRun = {
  params: StartRunParams;
  events: RunEvent[];
  seq: number;
  listeners: Set<Listener>;
  abort: AbortController;
  stopRequested: boolean;
  done: boolean;
  parts: MessagePart[];
  completion: Promise<void>;
};

export class RunManager {
  private runs = new Map<string, LiveRun>();
  private readonly now: () => number;
  private readonly flushIntervalMs: number;
  private readonly retainMs: number;

  constructor(private readonly deps: RunManagerDeps) {
    this.now = deps.now ?? Date.now;
    this.flushIntervalMs = deps.flushIntervalMs ?? 1000;
    this.retainMs = deps.retainMs ?? 60_000;
  }

  isLive(runId: string): boolean {
    const r = this.runs.get(runId);
    return !!r && !r.done;
  }

  get(runId: string) {
    const r = this.runs.get(runId);
    if (!r) return null;
    return { userId: r.params.userId, threadId: r.params.threadId, done: r.done, seq: r.seq };
  }

  /** Starts a run in the background and returns immediately. */
  start(params: StartRunParams): { completion: Promise<void> } {
    if (this.runs.has(params.runId)) throw new Error(`Run ${params.runId} already exists`);
    const run: LiveRun = {
      params,
      events: [],
      seq: 0,
      listeners: new Set(),
      abort: new AbortController(),
      stopRequested: false,
      done: false,
      parts: [],
      completion: Promise.resolve(),
    };
    this.runs.set(params.runId, run);
    run.completion = this.execute(run);
    return { completion: run.completion };
  }

  /** Emit an out-of-band event (e.g. a generated title) to a live run's subscribers. */
  publish(runId: string, event: RunEventInput) {
    const run = this.runs.get(runId);
    if (!run || run.done) return;
    this.emit(run, event);
  }

  stop(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.done) return false;
    run.stopRequested = true;
    run.abort.abort();
    return true;
  }

  /**
   * Subscribe to a run. Buffered events with seq > afterSeq are delivered synchronously
   * first, then live events. Returns null if the run isn't in memory.
   */
  subscribe(runId: string, afterSeq: number, listener: Listener): (() => void) | null {
    const run = this.runs.get(runId);
    if (!run) return null;
    for (const e of run.events) if (e.seq > afterSeq) listener(e);
    if (run.done) return () => {};
    run.listeners.add(listener);
    return () => run.listeners.delete(listener);
  }

  private emit(run: LiveRun, input: RunEventInput) {
    run.seq += 1;
    const event = { ...input, seq: run.seq } as RunEvent;
    run.events.push(event);
    for (const l of run.listeners) {
      try {
        l(event);
      } catch (err) {
        this.deps.log?.("[runs] listener error", err);
      }
    }
  }

  private async execute(run: LiveRun): Promise<void> {
    const { params } = run;
    const normalizer = new ResponseStreamNormalizer(this.now);
    let lastFlush = this.now();
    let flushing: Promise<void> = Promise.resolve();
    let thrown: unknown = null;

    const flush = () => {
      lastFlush = this.now();
      const snapshot = run.parts.slice();
      flushing = flushing
        .then(() => this.deps.saveParts(params.messageId, snapshot))
        .catch((err) => this.deps.log?.("[runs] saveParts failed", err));
    };

    const onOps = (ops: ReturnType<ResponseStreamNormalizer["apply"]>) => {
      if (ops.length === 0) return;
      run.parts = normalizer.snapshot().parts;
      this.emit(run, { type: "ops", ops });
      if (this.now() - lastFlush >= this.flushIntervalMs) flush();
    };

    try {
      const stream = await this.deps.openStream(params.body, run.abort.signal);
      for await (const event of stream) {
        onOps(normalizer.apply(event));
        if (run.stopRequested) break;
      }
    } catch (err) {
      if (!run.stopRequested) thrown = err;
    }

    onOps(normalizer.finalizeOpenParts());
    const snap = normalizer.snapshot();

    let runStatus: RunStatusValue;
    let messageStatus: MessageStatusValue;
    let error: string | null = null;
    const parts = snap.parts.slice();

    if (run.stopRequested) {
      runStatus = "STOPPED";
      messageStatus = "STOPPED";
    } else if (thrown || snap.status === "failed") {
      runStatus = "FAILED";
      messageStatus = "ERROR";
      error = snap.error ?? describeError(thrown);
      parts.push({ type: "error", id: `err_${params.runId}`, message: error });
    } else if (snap.status === "running") {
      // Stream ended without a terminal event.
      runStatus = "FAILED";
      messageStatus = "ERROR";
      error = "The connection to the model ended unexpectedly.";
      parts.push({ type: "error", id: `err_${params.runId}`, message: error });
    } else {
      runStatus = "COMPLETED";
      messageStatus = "COMPLETE";
      if (snap.status === "incomplete") {
        const reason = snap.incompleteReason ? ` (${snap.incompleteReason.replace(/_/g, " ")})` : "";
        parts.push({
          type: "error",
          id: `inc_${params.runId}`,
          message: `The response was cut off before it finished${reason}.`,
        });
      }
    }
    run.parts = parts;

    // Final parts are persisted by finish(); just wait for any in-flight flush.
    await flushing;

    let costMicros = 0;
    try {
      const res = await this.deps.finish({
        runId: params.runId,
        threadId: params.threadId,
        userId: params.userId,
        messageId: params.messageId,
        modelId: params.modelId,
        effort: params.effort,
        runStatus,
        messageStatus,
        parts,
        rawOutput: snap.rawOutput,
        error,
        responseId: snap.responseId,
        usage: snap.usage,
        webSearchCalls: snap.webSearchCalls,
      });
      costMicros = res.costMicros;
    } catch (err) {
      this.deps.log?.("[runs] finish failed", err);
    }

    this.emit(run, {
      type: "done",
      runStatus,
      messageStatus,
      parts,
      error,
      usage: snap.usage ?? (runStatus === "COMPLETED" ? emptyUsage() : null),
      costMicros,
      webSearchCalls: snap.webSearchCalls,
    });
    run.done = true;
    run.listeners.clear();
    const timer = setTimeout(() => this.runs.delete(params.runId), this.retainMs);
    (timer as { unref?: () => void }).unref?.();
  }
}

export function describeError(err: unknown): string {
  if (!err) return "Unknown error.";
  const e = err as { status?: number; message?: string; error?: { message?: string } };
  const detail = e.error?.message ?? e.message ?? String(err);
  if (e.status === 401 || e.status === 403) return `The model provider rejected the request (${e.status}). Check the CLIProxyAPI key.`;
  if (e.status === 429) return "The model provider is rate limiting requests. Try again shortly.";
  if (typeof e.status === "number") return `The model provider returned an error (${e.status}): ${detail}`;
  if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(detail)) return "Couldn't reach CLIProxyAPI. Check that it's running and CLIPROXY_BASE_URL is correct.";
  return detail;
}
