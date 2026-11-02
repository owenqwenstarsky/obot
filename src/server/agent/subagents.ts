/**
 * Sub-agent orchestration (T3 Code style). A parent run delegates tasks; each task is a child
 * thread with its own run. Children never outlive their parent run: stopping, failing, or
 * finishing the parent cancels any that are still running.
 *
 * All I/O is injected (store, launcher, run control) so this is testable without a database.
 * State that must be consistent with the loop's synchronous decisions (running/unnotified
 * tasks) lives in memory; the database is the durable record.
 */
import type { ClientTask, RunEventInput } from "@/lib/run-events";
import type { SubagentTaskStatusValue } from "@/lib/parts";
import type { RunFinish, TaskSettled, TaskWatcher } from "@/server/agent/run-manager";
import type { SubagentToolApi, TaskInfo, WaitOutcome } from "@/server/agent/tools/types";

export const TASK_RESULT_CAP = 32_000;

export type TaskRow = {
  id: string;
  userId: string;
  parentThreadId: string;
  parentRunId: string;
  parentMessageId: string | null;
  callId: string;
  childThreadId: string;
  childRunId: string | null;
  title: string;
  prompt: string;
  modelId: string;
  effort: string | null;
  status: SubagentTaskStatusValue;
  result: string | null;
  error: string | null;
  notifiedAt: Date | null;
  createdAt: Date;
  endedAt: Date | null;
};

export type AllowedModel = {
  id: string;
  displayName: string;
  description: string | null;
  efforts: string[];
  defaultEffort: string | null;
  supportsWebSearch: boolean;
};

export interface SubagentStore {
  allowedModels(): Promise<AllowedModel[]>;
  createTask(a: {
    userId: string;
    parentThreadId: string;
    parentRunId: string;
    parentMessageId: string | null;
    callId: string;
    title: string;
    prompt: string;
    modelId: string;
    effort: string | null;
  }): Promise<TaskRow>;
  setChildRun(taskId: string, runId: string): Promise<void>;
  /** Settle only if still RUNNING; returns the updated row or null if it was already settled. */
  settle(taskId: string, s: { status: Exclude<SubagentTaskStatusValue, "RUNNING">; result: string | null; error: string | null; notified: boolean }): Promise<TaskRow | null>;
  markNotified(taskIds: string[]): Promise<void>;
  listForParentRun(parentRunId: string): Promise<TaskRow[]>;
  get(taskId: string): Promise<TaskRow | null>;
}

export type ParentRun = {
  runId: string;
  threadId: string;
  rootThreadId: string;
  userId: string;
  messageId: string;
  modelId: string;
  webSearch: boolean;
};

export type SubagentDeps = {
  store: SubagentStore;
  /** Start the child's run. */
  launch(task: TaskRow, parent: ParentRun, model: AllowedModel): Promise<{ runId: string }>;
  stopRun(runId: string): boolean;
  publish(parentRunId: string, event: RunEventInput): void;
  canRun(userId: string, modelId: string): Promise<{ allowed: true } | { allowed: false; message: string }>;
  maxConcurrent(): Promise<number>;
  childToolNames(): Promise<string[]>;
  log?: (msg: string, err?: unknown) => void;
};

export function toClientTask(t: TaskRow): ClientTask {
  return {
    id: t.id,
    title: t.title,
    childThreadId: t.childThreadId,
    modelId: t.modelId,
    status: t.status,
    error: t.error,
    createdAt: t.createdAt.toISOString(),
    endedAt: t.endedAt?.toISOString() ?? null,
  };
}

const toInfo = (t: TaskRow): TaskInfo => ({
  taskId: t.id,
  title: t.title,
  childThreadId: t.childThreadId,
  modelId: t.modelId,
  status: t.status,
  result: t.result,
  error: t.error,
});

const toSettled = (t: TaskRow): TaskSettled => ({
  taskId: t.id,
  title: t.title,
  childThreadId: t.childThreadId,
  status: t.status as TaskSettled["status"],
  result: t.result,
  error: t.error,
});

export function capResult(text: string): string {
  if (text.length <= TASK_RESULT_CAP) return text;
  return `${text.slice(0, TASK_RESULT_CAP)}\n…(truncated; the full output is in the sub-agent thread)`;
}

function matchModel(allowed: AllowedModel[], wanted: string): AllowedModel | undefined {
  const w = wanted.trim().toLowerCase();
  return allowed.find((m) => m.id.toLowerCase() === w) ?? allowed.find((m) => m.displayName.toLowerCase() === w);
}

export class SubagentService {
  /** parentRunId → running tasks */
  private running = new Map<string, Map<string, TaskRow>>();
  /** parentRunId → settled tasks the model hasn't been told about yet */
  private unnotified = new Map<string, Map<string, TaskSettled>>();
  private subs = new Map<string, Set<(t: TaskSettled) => void>>();
  private childRunToTask = new Map<string, string>();
  private taskToParent = new Map<string, string>();

  constructor(private readonly deps: SubagentDeps) {}

  private runningFor(parentRunId: string) {
    let m = this.running.get(parentRunId);
    if (!m) this.running.set(parentRunId, (m = new Map()));
    return m;
  }

  private unnotifiedFor(parentRunId: string) {
    let m = this.unnotified.get(parentRunId);
    if (!m) this.unnotified.set(parentRunId, (m = new Map()));
    return m;
  }

  /** Mark a task settled (idempotent). `notified` = the parent model already knows. */
  async settle(
    taskId: string,
    s: { status: Exclude<SubagentTaskStatusValue, "RUNNING">; result: string | null; error: string | null },
    opts: { notified: boolean },
  ): Promise<TaskRow | null> {
    const row = await this.deps.store.settle(taskId, { ...s, notified: opts.notified });
    if (!row) return null;
    const parentRunId = row.parentRunId;
    this.running.get(parentRunId)?.delete(taskId);
    const settled = toSettled(row);
    if (!opts.notified) this.unnotifiedFor(parentRunId).set(taskId, settled);
    this.deps.publish(parentRunId, { type: "task", task: toClientTask(row) });
    for (const cb of this.subs.get(parentRunId) ?? []) {
      try {
        cb(settled);
      } catch (err) {
        this.deps.log?.("[subagents] subscriber failed", err);
      }
    }
    return row;
  }

  private async takeUnnotified(parentRunId: string, only?: Set<string>): Promise<TaskSettled[]> {
    const m = this.unnotified.get(parentRunId);
    if (!m || m.size === 0) return [];
    const out: TaskSettled[] = [];
    for (const [id, t] of m) {
      if (only && !only.has(id)) continue;
      out.push(t);
      m.delete(id);
    }
    if (out.length) await this.deps.store.markNotified(out.map((t) => t.taskId));
    return out;
  }

  watcher(parentRunId: string): TaskWatcher {
    return {
      runningIds: () => [...(this.running.get(parentRunId)?.keys() ?? [])],
      hasUnnotified: () => (this.unnotified.get(parentRunId)?.size ?? 0) > 0,
      takeUnnotified: () => this.takeUnnotified(parentRunId),
      onSettled: (cb) => {
        let set = this.subs.get(parentRunId);
        if (!set) this.subs.set(parentRunId, (set = new Set()));
        set.add(cb);
        return () => {
          set!.delete(cb);
          if (set!.size === 0) this.subs.delete(parentRunId);
        };
      },
      cancelAll: (reason) => this.cancelAll(parentRunId, reason),
    };
  }

  async cancelAll(parentRunId: string, reason: string) {
    const tasks = [...(this.running.get(parentRunId)?.values() ?? [])];
    await Promise.all(tasks.map((t) => this.cancel(t.id, reason, { notified: true })));
    this.running.delete(parentRunId);
    this.unnotified.delete(parentRunId);
  }

  /** Cancel one task. User-initiated cancels are not marked notified so the parent hears about it. */
  async cancel(taskId: string, reason: string, opts: { notified: boolean }): Promise<TaskRow | null> {
    const row = await this.settle(taskId, { status: "CANCELLED", result: null, error: reason }, opts);
    const current = row ?? (await this.deps.store.get(taskId));
    if (current?.childRunId) this.deps.stopRun(current.childRunId);
    return row ?? current;
  }

  /** Run-settled hook: a child run finished (or a parent run ended; drop its state). */
  async handleRunSettled(r: RunFinish) {
    if (r.kind !== "SUBAGENT") {
      this.running.delete(r.runId);
      this.unnotified.delete(r.runId);
      this.subs.delete(r.runId);
      return;
    }
    const taskId = this.childRunToTask.get(r.runId);
    if (!taskId) return;
    this.childRunToTask.delete(r.runId);
    const status = r.runStatus === "COMPLETED" ? "COMPLETED" : r.runStatus === "STOPPED" ? "CANCELLED" : "FAILED";
    const limited = r.runStatus === "COMPLETED" && !!r.error;
    await this.settle(
      taskId,
      {
        status: limited ? "FAILED" : status,
        result: r.finalText ? capResult(r.finalText) : null,
        error: limited ? r.error : status === "COMPLETED" ? null : (r.error ?? (status === "CANCELLED" ? "Stopped." : "The sub-agent failed.")),
      },
      { notified: false },
    );
    this.taskToParent.delete(taskId);
  }

  private async resolveModel(parent: ParentRun, wanted?: string): Promise<{ model: AllowedModel; allowed: AllowedModel[] }> {
    const allowed = await this.deps.store.allowedModels();
    if (allowed.length === 0) throw new Error("No sub-agent models are configured. Ask an admin to allow some.");
    if (wanted) {
      const m = matchModel(allowed, wanted);
      if (!m) throw new Error(`Model "${wanted}" isn't allowed for sub-agents. Allowed: ${allowed.map((a) => a.id).join(", ")}.`);
      return { model: m, allowed };
    }
    return { model: allowed.find((a) => a.id === parent.modelId) ?? allowed[0], allowed };
  }

  async delegate(
    parent: ParentRun,
    args: { title: string; prompt: string; model?: string; effort?: string; callId: string },
  ): Promise<TaskRow> {
    const max = await this.deps.maxConcurrent();
    const running = this.runningFor(parent.runId);
    if (running.size >= max) {
      throw new Error(
        `You already have ${running.size} sub-agents running (max ${max}). Wait for one to finish (you'll be notified automatically) or cancel one first.`,
      );
    }
    const { model } = await this.resolveModel(parent, args.model);
    let effort: string | null = model.defaultEffort;
    if (args.effort) {
      if (!model.efforts.includes(args.effort)) {
        throw new Error(`Effort "${args.effort}" isn't supported by ${model.id}. Options: ${model.efforts.join(", ") || "none"}.`);
      }
      effort = args.effort;
    }
    const gate = await this.deps.canRun(parent.userId, model.id);
    if (!gate.allowed) throw new Error(gate.message);

    const task = await this.deps.store.createTask({
      userId: parent.userId,
      parentThreadId: parent.threadId,
      parentRunId: parent.runId,
      parentMessageId: parent.messageId,
      callId: args.callId,
      title: args.title.trim().slice(0, 120) || "Sub-agent task",
      prompt: args.prompt,
      modelId: model.id,
      effort,
    });
    running.set(task.id, task);
    this.taskToParent.set(task.id, parent.runId);
    try {
      const { runId } = await this.deps.launch(task, parent, model);
      this.childRunToTask.set(runId, task.id);
      task.childRunId = runId;
      await this.deps.store.setChildRun(task.id, runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.settle(task.id, { status: "FAILED", result: null, error: `Couldn't start: ${message}` }, { notified: true });
      throw new Error(`Couldn't start the sub-agent: ${message}`);
    }
    this.deps.publish(parent.runId, { type: "task", task: toClientTask(task) });
    return task;
  }

  /** Tool-facing API bound to one parent run. */
  toolApi(parent: ParentRun): SubagentToolApi {
    const owned = async (taskId: string) => {
      const t = await this.deps.store.get(taskId);
      if (!t || t.parentRunId !== parent.runId) throw new Error(`Task ${taskId} not found in this turn.`);
      return t;
    };
    return {
      capabilities: async () => {
        const allowed = await this.deps.store.allowedModels();
        const def = allowed.find((a) => a.id === parent.modelId) ?? allowed[0];
        return {
          models: allowed.map((m) => ({
            id: m.id,
            name: m.displayName,
            description: m.description,
            efforts: m.efforts,
            defaultEffort: m.defaultEffort,
          })),
          defaultModel: def?.id ?? null,
          maxConcurrent: await this.deps.maxConcurrent(),
          running: this.running.get(parent.runId)?.size ?? 0,
          childTools: await this.deps.childToolNames(),
          notes:
            "Sub-agents start with no context except your brief. They can't delegate further or create artifacts, and they share your sandbox files. Their final message is returned to you.",
        };
      },
      delegate: async (args) => toInfo(await this.delegate(parent, args)),
      waitAny: (taskIds, opts) => this.waitAny(parent, taskIds, opts),
      status: async (taskIds) => {
        const all = await this.deps.store.listForParentRun(parent.runId);
        const list = taskIds?.length ? all.filter((t) => taskIds.includes(t.id)) : all;
        // Results returned here count as delivered.
        await this.takeUnnotified(parent.runId, new Set(list.filter((t) => t.status !== "RUNNING").map((t) => t.id)));
        return list.map(toInfo);
      },
      cancel: async (taskId) => {
        await owned(taskId);
        const row = await this.cancel(taskId, "Cancelled by the orchestrating agent.", { notified: true });
        return toInfo(row ?? (await owned(taskId)));
      },
    };
  }

  private async waitAny(
    parent: ParentRun,
    taskIds: string[],
    opts: { timeoutMs: number; signal: AbortSignal; onSteer?: (cb: () => void) => () => void },
  ): Promise<WaitOutcome> {
    const ids = new Set(taskIds);
    const list = async () => (await this.deps.store.listForParentRun(parent.runId)).filter((t) => ids.has(t.id));
    const known = await list();
    if (known.length === 0) throw new Error("None of those task ids belong to this turn.");

    const ready = await this.takeUnnotified(parent.runId, ids);
    if (ready.length > 0 || known.every((t) => t.status !== "RUNNING")) {
      return { reason: "settled", tasks: (await list()).map(toInfo) };
    }

    const reason = await new Promise<WaitOutcome["reason"]>((resolve) => {
      const cleanups: (() => void)[] = [];
      const done = (r: WaitOutcome["reason"]) => {
        for (const c of cleanups) c();
        resolve(r);
      };
      const unsub = this.watcher(parent.runId).onSettled((t) => {
        if (ids.has(t.taskId)) done("settled");
      });
      cleanups.push(unsub);
      const timer = setTimeout(() => done("timeout"), opts.timeoutMs);
      cleanups.push(() => clearTimeout(timer));
      const onAbort = () => done("interrupted");
      opts.signal.addEventListener("abort", onAbort, { once: true });
      cleanups.push(() => opts.signal.removeEventListener("abort", onAbort));
      if (opts.onSteer) cleanups.push(opts.onSteer(() => done("steer")));
    });
    if (reason === "settled") await this.takeUnnotified(parent.runId, ids);
    return { reason, tasks: (await list()).map(toInfo) };
  }
}
