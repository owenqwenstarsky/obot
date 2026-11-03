/**
 * In-memory registry of live agent runs. Runs execute detached from HTTP requests;
 * clients subscribe via SSE and can re-attach at any time by replaying events after a
 * sequence number. All I/O is injected so this can be tested without a DB or network.
 *
 * A run is a multi-step agent loop that writes into ONE assistant message:
 *   model call → (local tool calls → model call)* → done
 * Between steps the loop injects queued steering messages and sub-agent notifications.
 * When the model ends a step without tool calls while sub-agents are still running, the
 * run does not finish: it waits for them and wakes the model when one settles.
 */
import type { MessagePart, NoticePart, UsageSnapshot } from "@/lib/parts";
import { addUsage, emptyUsage } from "@/lib/parts";
import type { PartOp } from "@/lib/part-ops";
import type {
  PendingSteer,
  RunEvent,
  RunEventInput,
  RunPhase,
  RunStatusValue,
  MessageStatusValue,
} from "@/lib/run-events";
import { ResponseStreamNormalizer, type PendingFunctionCall, type StreamEvent } from "@/server/llm/stream-normalizer";
import {
  STORE_OUTPUT_CAP,
  outputItemsToTranscript,
  sanitizeForReplay,
  steerItem,
  taskNotificationItem,
  truncateMiddle,
  type StoredTranscript,
  type TaskNotification,
  type TranscriptItem,
} from "@/server/llm/transcript";
import { SteeringQueue } from "@/server/agent/steering";
import { EMPTY_TOOLSET, runToolCall, type ToolSet } from "@/server/agent/tools/registry";
import type { ThreadKindValue, ToolContext, ToolServices } from "@/server/agent/tools/types";

export type RunKind = ThreadKindValue;
export type UsageKindValue = "CHAT" | "SUBAGENT";

export type StartRunParams = {
  runId: string;
  threadId: string;
  userId: string;
  messageId: string;
  modelId: string;
  effort: string | null;
  /** Base request (history input, instructions, hosted tools). Tool specs are added per step. */
  body: unknown;
  rootThreadId?: string;
  kind?: RunKind;
  parentRunId?: string | null;
  modelHasPrice?: boolean;
  tools?: ToolSet;
  maxSteps?: number;
  usageKind?: UsageKindValue;
  /** Keep encrypted reasoning items in the current turn's transcript. */
  replayReasoning?: boolean;
  /** Forced tool choice for the first model call only (e.g. background artifact generation). */
  firstStepToolChoice?: { type: "function"; name: string };
  /** Opaque per-run data for services (e.g. pendingArtifactId). */
  meta?: Record<string, unknown>;
};

export type StepRecord = {
  runId: string;
  threadId: string;
  rootThreadId: string;
  userId: string;
  messageId: string;
  modelId: string;
  effort: string | null;
  usageKind: UsageKindValue;
  stepIndex: number;
  usage: UsageSnapshot | null;
  webSearchCalls: number;
  responseId: string | null;
  outcome: string;
};

export type RunFinish = {
  runId: string;
  threadId: string;
  rootThreadId: string;
  userId: string;
  messageId: string;
  modelId: string;
  effort: string | null;
  kind: RunKind;
  parentRunId: string | null;
  runStatus: RunStatusValue;
  messageStatus: MessageStatusValue;
  parts: MessagePart[];
  rawOutput: StoredTranscript;
  error: string | null;
  responseId: string | null;
  /** Sum across steps. */
  usage: UsageSnapshot | null;
  /** Last step's usage (context window). */
  contextUsage: UsageSnapshot | null;
  costMicros: number;
  webSearchCalls: number;
  steps: number;
  /** Text of the last model step that ended without tool calls (sub-agent result). */
  finalText: string;
  meta: Record<string, unknown>;
};

export type TaskSettled = TaskNotification & { childThreadId: string };

/** What the loop needs from the sub-agent system for a parent run. */
export interface TaskWatcher {
  runningIds(): string[];
  hasUnnotified(): boolean;
  /** Settled tasks not yet reported to the model; marks them notified. */
  takeUnnotified(): Promise<TaskSettled[]>;
  onSettled(cb: (t: TaskSettled) => void): () => void;
  cancelAll(reason: string): Promise<void>;
}

export type GateDecision = { allowed: true } | { allowed: false; message: string };

/** Handle given to service factories so tools can publish to the run. */
export type RunHandle = {
  publish(event: RunEventInput): void;
  steering: SteeringQueue;
};

export type RunManagerDeps = {
  /** Opens the upstream Responses stream. */
  openStream: (body: unknown, signal: AbortSignal) => Promise<AsyncIterable<StreamEvent>>;
  /** Persist in-progress parts + transcript (throttled). */
  saveProgress: (messageId: string, parts: MessagePart[], transcript: StoredTranscript | null) => Promise<void>;
  /** Record usage for one model call. Returns its cost in micro-dollars. */
  recordStep: (s: StepRecord) => Promise<{ costMicros: number }>;
  /** Re-checked before every model call after the first (spend limits). */
  canContinue?: (p: StartRunParams) => Promise<GateDecision>;
  /** Persist final state. */
  finish: (result: RunFinish) => Promise<void>;
  /** Per-run tool services. */
  services?: (p: StartRunParams, h: RunHandle) => Omit<ToolServices, "steering">;
  /** Sub-agent watcher for runs that can delegate. */
  watcher?: (p: StartRunParams) => TaskWatcher | null;
  /** Called after a run is fully finished and persisted. */
  onSettled?: (result: RunFinish) => void;
  now?: () => number;
  flushIntervalMs?: number;
  /** How long finished runs stay replayable in memory. */
  retainMs?: number;
  log?: (msg: string, err?: unknown) => void;
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
  steering: SteeringQueue;
  stepAbort: AbortController | null;
  interruptRequested: boolean;
  phase: RunPhase | null;
  wake: (() => void) | null;
  transcript: TranscriptItem[];
  lastFlush: number;
  flushing: Promise<void>;
};

type Outcome = "completed" | "limit" | "stopped" | "failed";

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
    return {
      userId: r.params.userId,
      threadId: r.params.threadId,
      kind: r.params.kind ?? "CHAT",
      parentRunId: r.params.parentRunId ?? null,
      done: r.done,
      seq: r.seq,
      phase: r.phase,
      pendingSteers: r.steering.snapshot(),
    };
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
      steering: new SteeringQueue(),
      stepAbort: null,
      interruptRequested: false,
      phase: null,
      wake: null,
      transcript: [],
      lastFlush: this.now(),
      flushing: Promise.resolve(),
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

  /** Stop the whole run (and, via the loop, any sub-agents it spawned). */
  stop(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.done) return false;
    run.stopRequested = true;
    run.abort.abort();
    this.wakeRun(run);
    return true;
  }

  /** Queue a steering message. `accepted: false` means the run is finishing; start a new turn. */
  steer(runId: string, s: PendingSteer): { accepted: boolean } {
    const run = this.runs.get(runId);
    if (!run || run.done || run.stopRequested) return { accepted: false };
    if (!run.steering.enqueue(s)) return { accepted: false };
    this.emit(run, { type: "steer_queue", pending: run.steering.snapshot() });
    this.wakeRun(run);
    return { accepted: true };
  }

  /** Abort only the current model call / tool batch. Never touches sub-agents. */
  interrupt(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.done || run.stopRequested) return false;
    run.interruptRequested = true;
    run.stepAbort?.abort();
    this.wakeRun(run);
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

  // ───────────────────────────── internals ─────────────────────────────

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

  private wakeRun(run: LiveRun) {
    const w = run.wake;
    run.wake = null;
    w?.();
  }

  private setPhase(run: LiveRun, phase: RunPhase, step: number) {
    if (run.phase === phase) return;
    run.phase = phase;
    this.emit(run, { type: "phase", phase, step });
  }

  private flush(run: LiveRun) {
    run.lastFlush = this.now();
    const parts = run.parts.slice();
    const transcript: StoredTranscript = { v: 2, items: sanitizeForReplay(run.transcript) };
    run.flushing = run.flushing
      .then(() => this.deps.saveProgress(run.params.messageId, parts, transcript))
      .catch((err) => this.deps.log?.("[runs] saveProgress failed", err));
  }

  private onOps(run: LiveRun, ops: PartOp[]) {
    if (ops.length === 0) return;
    this.emit(run, { type: "ops", ops });
    if (this.now() - run.lastFlush >= this.flushIntervalMs) this.flush(run);
  }

  private pushPart(run: LiveRun, part: MessagePart): number {
    const index = run.parts.length;
    run.parts.push(part);
    this.onOps(run, [{ op: "upsert", index, part }]);
    return index;
  }

  private setPart(run: LiveRun, index: number, part: MessagePart) {
    run.parts[index] = part;
    this.onOps(run, [{ op: "upsert", index, part }]);
  }

  private notice(run: LiveRun, kind: NoticePart["kind"], extra: Partial<NoticePart> = {}) {
    const at = this.now();
    this.pushPart(run, { type: "notice", id: `notice_${run.parts.length}_${at}`, at, kind, ...extra });
  }

  private errorPart(run: LiveRun, message: string, id = `err_${run.params.runId}_${run.parts.length}`) {
    this.pushPart(run, { type: "error", id, message });
  }

  /** Steering messages and sub-agent notifications become parts + transcript items. */
  private async injectBoundary(run: LiveRun, watcher: TaskWatcher | null): Promise<boolean> {
    let injected = false;
    if (watcher?.hasUnnotified()) {
      const settled = await watcher.takeUnnotified();
      if (settled.length > 0) {
        for (const t of settled) {
          const kind = t.status === "COMPLETED" ? "task_finished" : t.status === "CANCELLED" ? "task_cancelled" : "task_failed";
          this.notice(run, kind, {
            taskId: t.taskId,
            childThreadId: t.childThreadId,
            title: t.title,
            message: t.error ?? undefined,
          });
        }
        run.transcript.push(taskNotificationItem(settled, watcher.runningIds().length));
        injected = true;
      }
    }
    const steers = run.steering.drain();
    if (steers.length > 0) {
      for (const s of steers) {
        this.pushPart(run, { type: "steer", id: `steer_${s.id}`, text: s.text, at: s.at });
        run.transcript.push(steerItem(s.text));
      }
      this.emit(run, { type: "steer_queue", pending: run.steering.snapshot() });
      injected = true;
    }
    return injected;
  }

  /**
   * The model has nothing more to do right now. Wait for children if any are running.
   * Returns "continue" to call the model again, "finish" to end the run.
   */
  private async idle(run: LiveRun, watcher: TaskWatcher | null, step: number): Promise<"continue" | "finish" | "stopped"> {
    let waitingIndex: number | null = null;
    try {
      while (true) {
        if (run.stopRequested) return "stopped";
        if (run.steering.hasPending() || watcher?.hasUnnotified()) return "continue";
        const running = watcher?.runningIds() ?? [];
        if (running.length === 0) {
          return run.steering.closeIfEmpty() ? "finish" : "continue";
        }
        if (waitingIndex == null) {
          waitingIndex = this.pushPart(run, {
            type: "waiting",
            id: `wait_${run.parts.length}_${this.now()}`,
            taskIds: running,
            startedAt: this.now(),
          });
          this.setPhase(run, "waiting", step);
          this.flush(run);
        }
        await new Promise<void>((resolve) => {
          run.wake = resolve;
        });
        // An interrupt while waiting has nothing to abort; just re-evaluate.
        run.interruptRequested = false;
      }
    } finally {
      if (waitingIndex != null) {
        const p = run.parts[waitingIndex];
        if (p?.type === "waiting") this.setPart(run, waitingIndex, { ...p, endedAt: this.now() });
      }
    }
  }

  private async executeCalls(
    run: LiveRun,
    calls: PendingFunctionCall[],
    tools: ToolSet,
    services: ToolServices,
    step: number,
    signal: AbortSignal,
  ): Promise<TranscriptItem[]> {
    const { params } = run;
    const outputs: TranscriptItem[] = new Array(calls.length);

    const patch = (index: number, fn: (p: Extract<MessagePart, { tool: "function" }>) => MessagePart) => {
      const p = run.parts[index];
      if (p?.type === "tool" && p.tool === "function") this.setPart(run, index, fn(p));
    };

    const runOne = async (call: PendingFunctionCall, i: number) => {
      patch(call.partIndex, (p) => ({ ...p, status: "running" }));
      const ctx: ToolContext = {
        userId: params.userId,
        threadId: params.threadId,
        rootThreadId: params.rootThreadId ?? params.threadId,
        runId: params.runId,
        messageId: params.messageId,
        callId: call.callId,
        partIndex: call.partIndex,
        step,
        signal,
        emit: {
          patch: (fn) => patch(call.partIndex, fn),
          log: (delta) => {
            if (!delta) return;
            const p = run.parts[call.partIndex];
            if (p?.type !== "tool" || p.tool !== "function") return;
            run.parts[call.partIndex] = { ...p, log: (p.log ?? "") + delta };
            this.onOps(run, [{ op: "append_tool_log", index: call.partIndex, delta }]);
          },
        },
        services,
      };
      const res = await runToolCall(tools.get(call.name), call, ctx);
      patch(call.partIndex, (p) => ({
        ...p,
        status: res.aborted ? "cancelled" : res.isError ? "failed" : "completed",
        display: res.display ?? p.display,
        error: res.isError ? res.output.slice(0, 2000) : undefined,
        endedAt: this.now(),
      }));
      outputs[i] = { type: "function_call_output", call_id: call.callId, output: truncateMiddle(res.output, STORE_OUTPUT_CAP) };
    };

    const parallel: Promise<void>[] = [];
    const serial: [PendingFunctionCall, number][] = [];
    calls.forEach((c, i) => {
      if ((tools.get(c.name)?.concurrency ?? "parallel") === "serial") serial.push([c, i]);
      else parallel.push(runOne(c, i));
    });
    const serialRun = (async () => {
      for (const [c, i] of serial) await runOne(c, i);
    })();
    await Promise.all([...parallel, serialRun]);
    return outputs;
  }

  private async execute(run: LiveRun): Promise<void> {
    const { params } = run;
    const tools = params.tools ?? EMPTY_TOOLSET;
    const maxSteps = params.maxSteps ?? 50;
    const base = (params.body && typeof params.body === "object" ? params.body : {}) as Record<string, unknown>;
    const baseInput = Array.isArray(base.input) ? (base.input as unknown[]) : [];
    const baseTools = Array.isArray(base.tools) ? (base.tools as unknown[]) : [];
    const rootThreadId = params.rootThreadId ?? params.threadId;
    const usageKind: UsageKindValue = params.usageKind ?? (params.kind === "SUBAGENT" ? "SUBAGENT" : "CHAT");

    const handle: RunHandle = { publish: (e) => this.emit(run, e), steering: run.steering };
    let services: ToolServices = {
      steering: { onEnqueue: (cb) => run.steering.onEnqueue(cb), hasPending: () => run.steering.hasPending() },
    };
    let watcher: TaskWatcher | null = null;
    let unsubWatcher: (() => void) | undefined;

    let step = 0;
    let usageSum: UsageSnapshot | null = null;
    let lastUsage: UsageSnapshot | null = null;
    let costSum = 0;
    let webSearchCalls = 0;
    let responseId: string | null = null;
    let finalText = "";
    let outcome: Outcome = "completed";
    let error: string | null = null;

    try {
      services = { ...(this.deps.services?.(params, handle) ?? {}), ...services };
      watcher = this.deps.watcher?.(params) ?? null;
      unsubWatcher = watcher?.onSettled((t) => {
        // Live-update the delegate_task card, then wake the loop if it is waiting.
        run.parts.forEach((p, index) => {
          if (p.type === "tool" && p.tool === "function" && p.display?.kind === "subagent" && p.display.taskId === t.taskId) {
            this.setPart(run, index, { ...p, display: { ...p.display, status: t.status } });
          }
        });
        this.wakeRun(run);
      });

      loop: while (true) {
        await this.injectBoundary(run, watcher);
        if (run.stopRequested) {
          outcome = "stopped";
          break;
        }
        if (step >= maxSteps) {
          this.notice(run, "max_steps", { message: `Stopped after ${maxSteps} steps.` });
          outcome = "limit";
          break;
        }
        if (step > 0 && this.deps.canContinue) {
          const gate = await this.deps.canContinue(params);
          if (!gate.allowed) {
            this.errorPart(run, gate.message);
            this.notice(run, "limit_reached", { message: gate.message });
            outcome = "limit";
            error = gate.message;
            break;
          }
        }

        // ── One model call ──
        this.setPhase(run, "model", step);
        const stepAbort = new AbortController();
        const linkAbort = () => stepAbort.abort();
        run.abort.signal.addEventListener("abort", linkAbort, { once: true });
        run.stepAbort = stepAbort;
        run.interruptRequested = false;

        const normalizer = new ResponseStreamNormalizer(this.now, {
          parts: run.parts,
          idPrefix: step > 0 ? `s${step}_` : "",
        });
        const body: Record<string, unknown> = { ...base, input: [...baseInput, ...run.transcript] };
        if (tools.size > 0) {
          body.tools = [...baseTools, ...tools.specs];
          body.parallel_tool_calls = true;
          if (step === 0 && params.firstStepToolChoice && tools.has(params.firstStepToolChoice.name)) {
            body.tool_choice = params.firstStepToolChoice;
          }
        }

        let thrown: unknown = null;
        try {
          const stream = await this.deps.openStream(body, stepAbort.signal);
          for await (const event of stream) {
            this.onOps(run, normalizer.apply(event));
            if (run.stopRequested || run.interruptRequested) break;
          }
        } catch (err) {
          if (!run.stopRequested && !run.interruptRequested) thrown = err;
        }
        this.onOps(run, normalizer.finalizeOpenParts());
        const snap = normalizer.snapshot();
        const stepIndex = step;
        step += 1;

        const interrupted = run.interruptRequested && !run.stopRequested;
        const failed = !run.stopRequested && !interrupted && (!!thrown || snap.status === "failed" || snap.status === "running");
        usageSum = addUsage(usageSum, snap.usage);
        if (snap.usage) lastUsage = snap.usage;
        webSearchCalls += snap.webSearchCalls;
        responseId = snap.responseId ?? responseId;

        try {
          const rec = await this.deps.recordStep({
            runId: params.runId,
            threadId: params.threadId,
            rootThreadId,
            userId: params.userId,
            messageId: params.messageId,
            modelId: params.modelId,
            effort: params.effort,
            usageKind,
            stepIndex,
            usage: snap.usage,
            webSearchCalls: snap.webSearchCalls,
            responseId: snap.responseId,
            outcome: run.stopRequested ? "stopped" : interrupted ? "interrupted" : failed ? "failed" : snap.status,
          });
          costSum += rec.costMicros;
        } catch (err) {
          this.deps.log?.("[runs] recordStep failed", err);
        }

        const stepText = textSince(run.parts, snap.stepPartStart);
        const willExecute = !run.stopRequested && !interrupted && !failed && snap.status === "completed";
        if (!willExecute) {
          // Calls from an aborted or cut-off step are never executed.
          for (const c of snap.functionCalls) {
            const p = run.parts[c.partIndex];
            if (p?.type === "tool" && p.tool === "function" && p.status === "pending") {
              this.setPart(run, c.partIndex, { ...p, status: "cancelled", endedAt: this.now() });
            }
          }
        }

        if (run.stopRequested) {
          if (stepText) run.transcript.push({ role: "assistant", content: stepText });
          run.stepAbort = null;
          outcome = "stopped";
          break;
        }
        if (failed) {
          error = snap.status === "running" && !thrown ? "The connection to the model ended unexpectedly." : (snap.error ?? describeError(thrown));
          this.errorPart(run, error, `err_${params.runId}`);
          if (stepText) run.transcript.push({ role: "assistant", content: stepText });
          run.stepAbort = null;
          outcome = "failed";
          break;
        }
        if (interrupted) {
          if (stepText) run.transcript.push({ role: "assistant", content: stepText });
          this.notice(run, "interrupted");
          run.stepAbort = null;
          run.interruptRequested = false;
          this.flush(run);
          const next = await this.idle(run, watcher, step);
          if (next === "continue") continue;
          outcome = next === "stopped" ? "stopped" : "completed";
          break;
        }

        run.transcript.push(...outputItemsToTranscript(snap.rawOutput, { keepReasoning: !!params.replayReasoning }));

        if (snap.functionCalls.length > 0 && snap.status === "completed") {
          this.setPhase(run, "tools", stepIndex);
          const outputs = await this.executeCalls(run, snap.functionCalls, tools, services, stepIndex, stepAbort.signal);
          run.transcript.push(...outputs);
          run.stepAbort = null;
          run.abort.signal.removeEventListener("abort", linkAbort);
          this.flush(run);
          if (run.stopRequested) {
            outcome = "stopped";
            break;
          }
          if (run.interruptRequested) {
            run.interruptRequested = false;
            this.notice(run, "interrupted");
            const next = await this.idle(run, watcher, step);
            if (next === "continue") continue loop;
            outcome = next === "stopped" ? "stopped" : "completed";
            break;
          }
          continue;
        }
        run.stepAbort = null;
        run.abort.signal.removeEventListener("abort", linkAbort);

        if (snap.status === "incomplete") {
          const reason = snap.incompleteReason ? ` (${snap.incompleteReason.replace(/_/g, " ")})` : "";
          this.errorPart(run, `The response was cut off before it finished${reason}.`, `inc_${params.runId}_${stepIndex}`);
        }
        finalText = stepText || finalText;
        this.flush(run);
        const next = await this.idle(run, watcher, step);
        if (next === "continue") continue;
        outcome = next === "stopped" ? "stopped" : "completed";
        break;
      }
    } catch (err) {
      outcome = "failed";
      error = describeError(err);
      this.deps.log?.("[runs] loop crashed", err);
      try {
        this.errorPart(run, error, `err_${params.runId}`);
      } catch {
        // ignore
      }
    }

    // ── Wrap up ──
    unsubWatcher?.();
    const dropped = run.steering.close();
    if (dropped.length > 0) this.emit(run, { type: "steer_queue", pending: [] });
    if (outcome !== "completed" && watcher) {
      try {
        await watcher.cancelAll(outcome === "stopped" ? "The parent agent was stopped." : "The parent agent ended.");
      } catch (err) {
        this.deps.log?.("[runs] cancelAll failed", err);
      }
    }
    if (!finalText) finalText = lastText(run.parts);

    let runStatus: RunStatusValue;
    let messageStatus: MessageStatusValue;
    if (outcome === "stopped") {
      runStatus = "STOPPED";
      messageStatus = "STOPPED";
    } else if (outcome === "failed") {
      runStatus = "FAILED";
      messageStatus = "ERROR";
    } else {
      runStatus = "COMPLETED";
      messageStatus = "COMPLETE";
    }

    await run.flushing;
    const parts = run.parts.slice();
    const result: RunFinish = {
      runId: params.runId,
      threadId: params.threadId,
      rootThreadId,
      userId: params.userId,
      messageId: params.messageId,
      modelId: params.modelId,
      effort: params.effort,
      kind: params.kind ?? "CHAT",
      parentRunId: params.parentRunId ?? null,
      runStatus,
      messageStatus,
      parts,
      rawOutput: { v: 2, items: sanitizeForReplay(run.transcript) },
      error,
      responseId,
      usage: usageSum,
      contextUsage: lastUsage,
      costMicros: costSum,
      webSearchCalls,
      steps: step,
      finalText,
      meta: params.meta ?? {},
    };
    try {
      await this.deps.finish(result);
    } catch (err) {
      this.deps.log?.("[runs] finish failed", err);
    }

    this.emit(run, {
      type: "done",
      runStatus,
      messageStatus,
      parts,
      error,
      usage: usageSum ?? (runStatus === "COMPLETED" ? emptyUsage() : null),
      contextUsage: lastUsage,
      costMicros: costSum,
      webSearchCalls,
      steps: step,
    });
    run.done = true;
    run.listeners.clear();
    try {
      this.deps.onSettled?.(result);
    } catch (err) {
      this.deps.log?.("[runs] onSettled failed", err);
    }
    const timer = setTimeout(() => this.runs.delete(params.runId), this.retainMs);
    (timer as { unref?: () => void }).unref?.();
  }
}

/** Joined text of text parts at or after `start`. */
export function textSince(parts: MessagePart[], start: number): string {
  const out: string[] = [];
  for (let i = start; i < parts.length; i++) {
    const p = parts[i];
    if (p.type === "text" && p.text.trim()) out.push(p.text);
  }
  return out.join("\n\n");
}

/** Last non-empty text part in the message. */
export function lastText(parts: MessagePart[]): string {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.type === "text" && p.text.trim()) return p.text;
  }
  return "";
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
