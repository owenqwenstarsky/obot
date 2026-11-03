import { describe, expect, it } from "vitest";
import {
  SubagentService,
  capResult,
  TASK_RESULT_CAP,
  type AllowedModel,
  type ParentRun,
  type SubagentDeps,
  type SubagentStore,
  type TaskRow,
} from "@/server/agent/subagents";
import { RunManager, type RunFinish, type StartRunParams } from "@/server/agent/run-manager";
import { ToolSet } from "@/server/agent/tools/registry";
import { subagentTools } from "@/server/agent/tools/subagents";
import type { StreamEvent } from "@/server/llm/stream-normalizer";
import type { RunEvent, RunEventInput } from "@/lib/run-events";

const MODELS: AllowedModel[] = [
  { id: "cheap", displayName: "Cheap", description: "fast", efforts: ["low", "medium"], defaultEffort: "low", supportsWebSearch: true },
  { id: "smart", displayName: "Smart", description: "deep", efforts: [], defaultEffort: null, supportsWebSearch: false },
];

function memoryStore(models = MODELS) {
  const tasks = new Map<string, TaskRow>();
  let n = 0;
  const store: SubagentStore = {
    allowedModels: async () => models,
    createTask: async (a) => {
      const id = `task${++n}`;
      const row: TaskRow = {
        id,
        ...a,
        childThreadId: `child_${id}`,
        childRunId: null,
        status: "RUNNING",
        result: null,
        error: null,
        notifiedAt: null,
        createdAt: new Date(1000 + n),
        endedAt: null,
      };
      tasks.set(id, row);
      return { ...row };
    },
    setChildRun: async (id, runId) => {
      tasks.get(id)!.childRunId = runId;
    },
    settle: async (id, s) => {
      const t = tasks.get(id);
      if (!t || t.status !== "RUNNING") return null;
      Object.assign(t, { status: s.status, result: s.result, error: s.error, endedAt: new Date(), notifiedAt: s.notified ? new Date() : null });
      return { ...t };
    },
    markNotified: async (ids) => {
      for (const id of ids) {
        const t = tasks.get(id);
        if (t && !t.notifiedAt) t.notifiedAt = new Date();
      }
    },
    listForParentRun: async (pr) => [...tasks.values()].filter((t) => t.parentRunId === pr).map((t) => ({ ...t })),
    get: async (id) => (tasks.has(id) ? { ...tasks.get(id)! } : null),
  };
  return { store, tasks };
}

const parent: ParentRun = {
  runId: "prun",
  threadId: "pthread",
  rootThreadId: "pthread",
  userId: "u1",
  messageId: "pmsg",
  modelId: "smart",
  webSearch: true,
};

function service(overrides: Partial<SubagentDeps> = {}) {
  const { store, tasks } = memoryStore();
  const launched: { task: TaskRow; model: AllowedModel }[] = [];
  const stopped: string[] = [];
  const published: { runId: string; event: RunEventInput }[] = [];
  const svc = new SubagentService({
    store,
    launch: async (task, _p, model) => {
      launched.push({ task, model });
      return { runId: `crun_${task.id}` };
    },
    stopRun: (runId) => {
      stopped.push(runId);
      return true;
    },
    publish: (runId, event) => published.push({ runId, event }),
    canRun: async () => ({ allowed: true }),
    maxConcurrent: async () => 2,
    childToolNames: async () => ["bash", "write_file"],
    ...overrides,
  });
  return { svc, tasks, launched, stopped, published };
}

const finish = (runId: string, over: Partial<RunFinish> = {}): RunFinish => ({
  runId,
  threadId: "child",
  rootThreadId: "pthread",
  userId: "u1",
  messageId: "cm",
  modelId: "cheap",
  effort: null,
  kind: "SUBAGENT",
  parentRunId: "prun",
  runStatus: "COMPLETED",
  messageStatus: "COMPLETE",
  parts: [],
  rawOutput: { v: 2, items: [] },
  error: null,
  responseId: null,
  usage: null,
  contextUsage: null,
  costMicros: 0,
  webSearchCalls: 0,
  steps: 1,
  finalText: "Result text",
  meta: {},
  ...over,
});

describe("SubagentService", () => {
  it("delegates on the parent's model when allowed, else the first allowed model", async () => {
    const { svc, launched, published } = service();
    const t = await svc.delegate(parent, { title: "A", prompt: "do A", callId: "c1" });
    expect(t.modelId).toBe("smart");
    const t2 = await svc.delegate({ ...parent, modelId: "other" }, { title: "B", prompt: "do B", callId: "c2" });
    expect(t2.modelId).toBe("cheap");
    expect(t2.effort).toBe("low");
    expect(launched).toHaveLength(2);
    expect(published.filter((p) => p.event.type === "task")).toHaveLength(2);
  });

  it("validates explicit models and efforts against the allowlist", async () => {
    const { svc } = service();
    await expect(svc.delegate(parent, { title: "A", prompt: "x", model: "gpt-x", callId: "c" })).rejects.toThrow(/isn't allowed/);
    await expect(svc.delegate(parent, { title: "A", prompt: "x", model: "Cheap", effort: "xhigh", callId: "c" })).rejects.toThrow(
      /isn't supported/,
    );
    const ok = await svc.delegate(parent, { title: "A", prompt: "x", model: "Cheap", effort: "medium", callId: "c" });
    expect(ok).toMatchObject({ modelId: "cheap", effort: "medium" });
  });

  it("enforces the concurrency cap and the spend gate", async () => {
    const { svc } = service();
    await svc.delegate(parent, { title: "1", prompt: "x", callId: "c1" });
    await svc.delegate(parent, { title: "2", prompt: "x", callId: "c2" });
    await expect(svc.delegate(parent, { title: "3", prompt: "x", callId: "c3" })).rejects.toThrow(/max 2/);
    const gated = service({ canRun: async () => ({ allowed: false, message: "Weekly limit reached." }) });
    await expect(gated.svc.delegate(parent, { title: "x", prompt: "x", callId: "c" })).rejects.toThrow(/Weekly limit/);
  });

  it("refuses when no models are allowed", async () => {
    const { store } = memoryStore([]);
    const svc = new SubagentService({
      store,
      launch: async () => ({ runId: "r" }),
      stopRun: () => true,
      publish: () => {},
      canRun: async () => ({ allowed: true }),
      maxConcurrent: async () => 4,
      childToolNames: async () => [],
    });
    await expect(svc.delegate(parent, { title: "x", prompt: "x", callId: "c" })).rejects.toThrow(/No sub-agent models/);
  });

  it("settles child runs once and exposes them to the watcher", async () => {
    const { svc, tasks } = service();
    const w = svc.watcher("prun");
    const seen: string[] = [];
    w.onSettled((t) => seen.push(t.taskId));
    const t = await svc.delegate(parent, { title: "A", prompt: "x", callId: "c" });
    expect(w.runningIds()).toEqual([t.id]);
    await svc.handleRunSettled(finish(`crun_${t.id}`));
    await svc.handleRunSettled(finish(`crun_${t.id}`));
    expect(seen).toEqual([t.id]);
    expect(w.runningIds()).toEqual([]);
    expect(w.hasUnnotified()).toBe(true);
    const settled = await w.takeUnnotified();
    expect(settled).toEqual([{ taskId: t.id, title: "A", childThreadId: `child_${t.id}`, status: "COMPLETED", result: "Result text", error: null }]);
    expect(w.hasUnnotified()).toBe(false);
    expect(tasks.get(t.id)?.notifiedAt).toBeInstanceOf(Date);
  });

  it("maps child failures, stops and limit errors", async () => {
    const { svc, tasks } = service();
    const a = await svc.delegate(parent, { title: "A", prompt: "x", callId: "a" });
    const b = await svc.delegate(parent, { title: "B", prompt: "x", callId: "b" });
    await svc.handleRunSettled(finish(`crun_${a.id}`, { runStatus: "FAILED", error: "boom", finalText: "" }));
    await svc.handleRunSettled(finish(`crun_${b.id}`, { runStatus: "COMPLETED", error: "Over your limit." }));
    expect(tasks.get(a.id)).toMatchObject({ status: "FAILED", error: "boom", result: null });
    expect(tasks.get(b.id)).toMatchObject({ status: "FAILED", error: "Over your limit." });
  });

  it("cancelAll stops running children and marks them notified", async () => {
    const { svc, tasks, stopped } = service();
    const a = await svc.delegate(parent, { title: "A", prompt: "x", callId: "a" });
    await svc.watcher("prun").cancelAll("Parent stopped");
    expect(stopped).toEqual([`crun_${a.id}`]);
    expect(tasks.get(a.id)).toMatchObject({ status: "CANCELLED", error: "Parent stopped" });
    expect(tasks.get(a.id)?.notifiedAt).toBeInstanceOf(Date);
    // The child's own finish afterwards is a no-op.
    await svc.handleRunSettled(finish(`crun_${a.id}`, { runStatus: "STOPPED" }));
    expect(tasks.get(a.id)?.status).toBe("CANCELLED");
  });

  it("user cancels are reported to the parent model", async () => {
    const { svc } = service();
    const a = await svc.delegate(parent, { title: "A", prompt: "x", callId: "a" });
    await svc.cancel(a.id, "Cancelled by the user.", { notified: false });
    expect(svc.watcher("prun").hasUnnotified()).toBe(true);
  });

  it("waitAny resolves on settle and marks the result delivered", async () => {
    const { svc } = service();
    const api = svc.toolApi(parent);
    const a = await api.delegate({ title: "A", prompt: "x", callId: "a" });
    const p = api.waitAny([a.taskId], { timeoutMs: 5_000, signal: new AbortController().signal });
    await new Promise((r) => setTimeout(r, 0));
    await svc.handleRunSettled(finish(`crun_${a.taskId}`));
    const res = await p;
    expect(res.reason).toBe("settled");
    expect(res.tasks[0]).toMatchObject({ status: "COMPLETED", result: "Result text" });
    expect(svc.watcher("prun").hasUnnotified()).toBe(false);
  });

  it("waitAny returns early on steer, abort and timeout", async () => {
    const { svc } = service();
    const api = svc.toolApi(parent);
    const a = await api.delegate({ title: "A", prompt: "x", callId: "a" });
    let fire: () => void = () => {};
    const steer = api.waitAny([a.taskId], {
      timeoutMs: 5_000,
      signal: new AbortController().signal,
      onSteer: (cb) => {
        fire = cb;
        return () => {};
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    fire();
    expect((await steer).reason).toBe("steer");
    const ac = new AbortController();
    const aborted = api.waitAny([a.taskId], { timeoutMs: 5_000, signal: ac.signal });
    await new Promise((r) => setTimeout(r, 0));
    ac.abort();
    expect((await aborted).reason).toBe("interrupted");
    expect((await api.waitAny([a.taskId], { timeoutMs: 10, signal: new AbortController().signal })).reason).toBe("timeout");
    await expect(api.waitAny(["nope"], { timeoutMs: 10, signal: new AbortController().signal })).rejects.toThrow(/belong/);
  });

  it("reports capabilities", async () => {
    const { svc } = service();
    const caps = await svc.toolApi({ ...parent, modelId: "zzz" }).capabilities();
    expect(caps).toMatchObject({ defaultModel: "cheap", maxConcurrent: 2, running: 0, childTools: ["bash", "write_file"] });
    expect((caps.models as { id: string }[]).map((m) => m.id)).toEqual(["cheap", "smart"]);
  });

  it("caps long results", () => {
    expect(capResult("x".repeat(TASK_RESULT_CAP + 10))).toContain("truncated");
  });
});

// ─────────────── End to end: real RunManager loop + SubagentService ───────────────

const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };
const completed: StreamEvent = { type: "response.completed", response: { usage } };
const text = (id: string, t: string): StreamEvent[] => [
  { type: "response.output_item.added", item: { id, type: "message" } },
  { type: "response.output_text.delta", item_id: id, delta: t },
  { type: "response.output_item.done", item: { id, type: "message", content: [{ type: "output_text", text: t }] } },
];
const call = (id: string, name: string, args: unknown): StreamEvent[] => [
  { type: "response.output_item.added", item: { id, type: "function_call", call_id: `call_${id}`, name, arguments: "" } },
  { type: "response.output_item.done", item: { id, type: "function_call", call_id: `call_${id}`, name, arguments: JSON.stringify(args) } },
];

describe("sub-agents end to end", () => {
  it("delegates two tasks, acknowledges each as it finishes, and keeps waiting without re-calling wait", async () => {
    const { store, tasks } = memoryStore();
    const parentBodies: Record<string, unknown>[] = [];
    const childGates = new Map<string, () => void>();
    const parentScripts: StreamEvent[][] = [
      [...call("d1", "delegate_task", { title: "Fast", prompt: "fast job" }), ...call("d2", "delegate_task", { title: "Slow", prompt: "slow job" }), completed],
      [...text("p1", "Started two sub-agents."), completed],
      [...text("p2", "Fast finished: 42."), completed],
      [...text("p3", "Slow finished too. Final answer."), completed],
    ];

    // eslint-disable-next-line prefer-const
    let svc: SubagentService;
    const manager: RunManager = new RunManager({
      openStream: async (body, signal) => {
        const b = body as { marker?: string; input?: unknown[] };
        const script = await (async (): Promise<StreamEvent[]> => {
          if (b.marker?.startsWith("child:")) {
            const childId = b.marker.slice(6);
            await new Promise<void>((r) => childGates.set(childId, r));
            return [...text(`c_${childId}`, `answer from ${childId}`), completed];
          }
          parentBodies.push(structuredClone(b) as Record<string, unknown>);
          return parentScripts.shift() ?? [completed];
        })();
        return {
          async *[Symbol.asyncIterator]() {
            for (const e of script) {
              if (signal.aborted) throw new Error("aborted");
              yield e;
            }
          },
        };
      },
      saveProgress: async () => {},
      recordStep: async () => ({ costMicros: 0 }),
      finish: async () => {},
      watcher: (p) => ((p.kind ?? "CHAT") === "CHAT" ? svc.watcher(p.runId) : null),
      services: (p) =>
        (p.kind ?? "CHAT") === "CHAT"
          ? {
              tasks: svc.toolApi({ ...parent, runId: p.runId, messageId: p.messageId }),
            }
          : {},
      onSettled: (r) => void svc.handleRunSettled(r),
      retainMs: 10_000,
    });
    svc = new SubagentService({
      store,
      launch: async (task, p) => {
        const runId = `crun_${task.id}`;
        manager.start({
          runId,
          threadId: task.childThreadId,
          userId: task.userId,
          messageId: `cmsg_${task.id}`,
          modelId: task.modelId,
          effort: null,
          kind: "SUBAGENT",
          parentRunId: p.runId,
          body: { marker: `child:${task.id}` },
        });
        return { runId };
      },
      stopRun: (id) => manager.stop(id),
      publish: (id, e) => manager.publish(id, e),
      canRun: async () => ({ allowed: true }),
      maxConcurrent: async () => 4,
      childToolNames: async () => [],
    });

    const tools = new ToolSet(subagentTools);
    const events: RunEvent[] = [];
    const params: StartRunParams = {
      runId: "prun",
      threadId: "pthread",
      userId: "u1",
      messageId: "pmsg",
      modelId: "smart",
      effort: null,
      body: { input: [] },
      tools,
    };
    const { completion } = manager.start(params);
    manager.subscribe("prun", 0, (e) => events.push(e));

    const until = async (cond: () => boolean) => {
      for (let i = 0; i < 500 && !cond(); i++) await new Promise((r) => setTimeout(r, 0));
      if (!cond()) throw new Error("timeout");
    };
    await until(() => events.some((e) => e.type === "phase" && e.phase === "waiting") && childGates.size === 2);
    expect(parentBodies).toHaveLength(2);

    childGates.get("task1")!();
    await until(() => parentBodies.length === 3);
    const third = (parentBodies[2].input as { content?: { text?: string }[] }[]).at(-1)?.content?.[0]?.text ?? "";
    expect(third).toContain('task_id="task1"');
    expect(third).toContain("answer from task1");
    expect(third).toContain("1 other sub-agent task is still running");
    await until(() => events.filter((e) => e.type === "phase" && e.phase === "waiting").length >= 2);

    childGates.get("task2")!();
    await completion;

    expect(parentBodies).toHaveLength(4);
    const done = events.at(-1);
    if (done?.type !== "done") throw new Error("no done");
    expect(done.runStatus).toBe("COMPLETED");
    const types = done.parts.map((p) => (p.type === "tool" ? `tool:${p.tool === "function" ? p.name : p.tool}` : p.type));
    expect(types).toEqual([
      "tool:delegate_task",
      "tool:delegate_task",
      "text",
      "waiting",
      "notice",
      "text",
      "waiting",
      "notice",
      "text",
    ]);
    const cards = done.parts.filter((p) => p.type === "tool" && p.tool === "function" && p.display?.kind === "subagent");
    expect(cards.map((c) => c.type === "tool" && c.tool === "function" && c.display?.kind === "subagent" && c.display.status)).toEqual([
      "COMPLETED",
      "COMPLETED",
    ]);
    expect([...tasks.values()].every((t) => t.status === "COMPLETED" && t.notifiedAt)).toBe(true);
    expect(events.some((e) => e.type === "task" && e.task.status === "COMPLETED")).toBe(true);
  });
});
