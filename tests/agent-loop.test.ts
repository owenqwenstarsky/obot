import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  RunManager,
  type RunFinish,
  type StartRunParams,
  type StepRecord,
  type TaskSettled,
  type TaskWatcher,
} from "@/server/agent/run-manager";
import { ToolSet } from "@/server/agent/tools/registry";
import { defineTool, type ToolContext } from "@/server/agent/tools/types";
import type { StreamEvent } from "@/server/llm/stream-normalizer";
import type { RunEvent } from "@/lib/run-events";
import { applyPartOps } from "@/lib/part-ops";
import type { MessagePart } from "@/lib/parts";

type Script = StreamEvent[] | Error | "hang" | "hold";

const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };

const text = (id: string, t: string): StreamEvent[] => [
  { type: "response.output_item.added", item: { id, type: "message" } },
  { type: "response.output_text.delta", item_id: id, delta: t },
  { type: "response.output_item.done", item: { id, type: "message", content: [{ type: "output_text", text: t }] } },
];
const call = (id: string, callId: string, name: string, args: unknown): StreamEvent[] => {
  const json = JSON.stringify(args);
  return [
    { type: "response.output_item.added", item: { id, type: "function_call", call_id: callId, name, arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: id, delta: json.slice(0, 3) },
    { type: "response.function_call_arguments.delta", item_id: id, delta: json.slice(3) },
    { type: "response.output_item.done", item: { id, type: "function_call", call_id: callId, name, arguments: json } },
  ];
};
const completed: StreamEvent = { type: "response.completed", response: { id: "resp", usage } };

/** Upstream that serves one script per model call and records request bodies. */
function scripted(scripts: Script[]) {
  const bodies: Record<string, unknown>[] = [];
  let hangRelease: (() => void) | null = null;
  const openStream = async (body: unknown, signal: AbortSignal): Promise<AsyncIterable<StreamEvent>> => {
    bodies.push(structuredClone(body) as Record<string, unknown>);
    const script = scripts.shift() ?? [completed];
    return {
      async *[Symbol.asyncIterator]() {
        if (script instanceof Error) throw script;
        if (script === "hold") {
          yield* text("held", "First answer");
          await new Promise<void>((resolve) => {
            hangRelease = resolve;
          });
          yield completed;
          return;
        }
        if (script === "hang") {
          yield* text("partial", "Partial");
          await new Promise<void>((resolve) => {
            hangRelease = resolve;
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
          if (signal.aborted) throw new Error("aborted");
          return;
        }
        for (const e of script) {
          if (signal.aborted) throw new Error("aborted");
          yield e;
        }
      },
    };
  };
  return { openStream, bodies, release: () => hangRelease?.() };
}

class FakeWatcher implements TaskWatcher {
  running = new Set<string>();
  unnotified: TaskSettled[] = [];
  cancelled: string[] = [];
  private subs = new Set<(t: TaskSettled) => void>();
  runningIds() {
    return [...this.running];
  }
  hasUnnotified() {
    return this.unnotified.length > 0;
  }
  async takeUnnotified() {
    const out = this.unnotified;
    this.unnotified = [];
    return out;
  }
  onSettled(cb: (t: TaskSettled) => void) {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }
  async cancelAll(reason: string) {
    this.cancelled.push(reason);
    this.running.clear();
  }
  settle(t: Omit<TaskSettled, "childThreadId"> & { childThreadId?: string }) {
    const full = { childThreadId: `child_${t.taskId}`, ...t };
    this.running.delete(t.taskId);
    this.unnotified.push(full);
    for (const s of this.subs) s(full);
  }
}

function setup(scripts: Script[], opts: { tools?: ToolSet; watcher?: TaskWatcher; gate?: () => boolean; maxSteps?: number } = {}) {
  const upstream = scripted(scripts);
  const steps: StepRecord[] = [];
  const finished: RunFinish[] = [];
  let t = 0;
  const manager = new RunManager({
    openStream: upstream.openStream,
    saveProgress: async () => {},
    recordStep: async (s) => {
      steps.push(s);
      return { costMicros: 100 };
    },
    canContinue: async () => (opts.gate && !opts.gate() ? { allowed: false, message: "Over your limit." } : { allowed: true }),
    finish: async (r) => {
      finished.push(r);
    },
    watcher: () => opts.watcher ?? null,
    now: () => (t += 10),
    flushIntervalMs: 1_000_000,
    retainMs: 10_000,
  });
  const events: RunEvent[] = [];
  const params: StartRunParams = {
    runId: "run1",
    threadId: "t1",
    userId: "u1",
    messageId: "m1",
    modelId: "gpt-6-luna",
    effort: null,
    body: { input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }] },
    tools: opts.tools,
    maxSteps: opts.maxSteps,
  };
  const start = () => {
    const r = manager.start(params);
    manager.subscribe("run1", 0, (e) => events.push(e));
    return r;
  };
  return { manager, upstream, steps, finished, events, start };
}

function replay(events: RunEvent[]): MessagePart[] {
  let parts: MessagePart[] = [];
  for (const e of events) if (e.type === "ops") parts = applyPartOps(parts, e.ops);
  return parts;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(cond: () => boolean, max = 200) {
  for (let i = 0; i < max && !cond(); i++) await tick();
  if (!cond()) throw new Error("condition never became true");
}

function echoTool(name = "echo", extra: Partial<Parameters<typeof defineTool>[0]> = {}) {
  const seen: { args: unknown; ctx: ToolContext }[] = [];
  const def = defineTool({
    name,
    description: "Echo",
    schema: z.object({ value: z.string() }),
    available: () => true,
    execute: async (args, ctx) => {
      seen.push({ args, ctx });
      return { output: `echo:${(args as { value: string }).value}` };
    },
    ...extra,
  });
  return { def, seen };
}

describe("agent loop", () => {
  it("runs a function tool round trip with continuous part indexes and per-step usage", async () => {
    const echo = echoTool();
    const { start, upstream, steps, finished, events } = setup(
      [[...call("fc1", "call_1", "echo", { value: "x" }), completed], [...text("msg", "Done"), completed]],
      { tools: new ToolSet([echo.def]) },
    );
    await start().completion;

    expect(echo.seen).toHaveLength(1);
    expect(echo.seen[0].args).toEqual({ value: "x" });
    expect(echo.seen[0].ctx).toMatchObject({ runId: "run1", threadId: "t1", rootThreadId: "t1", callId: "call_1", partIndex: 0 });

    // Step 2 input ends with the call and its output.
    expect(upstream.bodies).toHaveLength(2);
    const input2 = upstream.bodies[1].input as unknown[];
    expect(input2.slice(-2)).toEqual([
      { type: "function_call", call_id: "call_1", name: "echo", arguments: '{"value":"x"}' },
      { type: "function_call_output", call_id: "call_1", output: "echo:x" },
    ]);
    expect((upstream.bodies[0].tools as { name: string }[]).map((t) => t.name)).toEqual(["echo"]);
    expect(upstream.bodies[0].parallel_tool_calls).toBe(true);

    const done = events.at(-1);
    if (done?.type !== "done") throw new Error("no done");
    expect(done.parts.map((p) => p.type)).toEqual(["tool", "text"]);
    expect(done.parts[0]).toMatchObject({ tool: "function", status: "completed", argsText: '{"value":"x"}' });
    expect(done.parts[1].id).toBe("s1_msg");
    expect(replay(events)).toEqual(done.parts);
    expect(steps.map((s) => s.stepIndex)).toEqual([0, 1]);
    expect(done.usage?.totalTokens).toBe(30);
    expect(done.contextUsage?.totalTokens).toBe(15);
    expect(done.costMicros).toBe(200);
    expect(done.steps).toBe(2);
    expect(finished[0].finalText).toBe("Done");
    expect(finished[0].rawOutput.items.map((i) => ("type" in i ? i.type : i.role))).toEqual([
      "function_call",
      "function_call_output",
      "assistant",
    ]);
  });

  it("returns error outputs for invalid JSON, schema failures and unknown tools, then continues", async () => {
    const echo = echoTool();
    const { start, upstream, finished } = setup(
      [
        [
          { type: "response.output_item.added", item: { id: "a", type: "function_call", call_id: "c1", name: "echo", arguments: "" } },
          { type: "response.output_item.done", item: { id: "a", type: "function_call", call_id: "c1", name: "echo", arguments: "{bad" } },
          ...call("b", "c2", "echo", { value: 5 }),
          ...call("c", "c3", "nope", {}),
          completed,
        ],
        [...text("msg", "ok"), completed],
      ],
      { tools: new ToolSet([echo.def]) },
    );
    await start().completion;
    expect(echo.seen).toHaveLength(0);
    const outputs = (upstream.bodies[1].input as { type?: string; output?: string }[]).filter((i) => i.type === "function_call_output");
    expect(outputs[0].output).toMatch(/not valid JSON/);
    expect(outputs[1].output).toMatch(/invalid arguments/);
    expect(outputs[2].output).toMatch(/unknown tool/);
    expect(finished[0].parts.filter((p) => p.type === "tool").every((p) => p.type === "tool" && p.tool === "function" && p.status === "failed")).toBe(true);
    expect(finished[0].runStatus).toBe("COMPLETED");
  });

  it("runs serial tools in order and keeps outputs in call order", async () => {
    const order: string[] = [];
    const slow = defineTool({
      name: "slow",
      description: "",
      schema: z.object({ id: z.string() }),
      available: () => true,
      concurrency: "serial",
      execute: async (a) => {
        order.push(`start:${(a as { id: string }).id}`);
        await tick();
        order.push(`end:${(a as { id: string }).id}`);
        return { output: (a as { id: string }).id };
      },
    });
    const { start, upstream } = setup(
      [[...call("a", "c1", "slow", { id: "1" }), ...call("b", "c2", "slow", { id: "2" }), completed], [completed]],
      { tools: new ToolSet([slow]) },
    );
    await start().completion;
    expect(order).toEqual(["start:1", "end:1", "start:2", "end:2"]);
    const outputs = (upstream.bodies[1].input as { type?: string; output?: string }[]).filter((i) => i.type === "function_call_output");
    expect(outputs.map((o) => o.output)).toEqual(["1", "2"]);
  });

  it("stops at maxSteps with a notice", async () => {
    const echo = echoTool();
    const loopCall = () => [...call(`fc${Math.random()}`, `c${Math.random()}`, "echo", { value: "x" }), completed];
    const { start, finished } = setup([loopCall(), loopCall(), loopCall()], { tools: new ToolSet([echo.def]), maxSteps: 2 });
    await start().completion;
    expect(finished[0].steps).toBe(2);
    expect(finished[0].parts.at(-1)).toMatchObject({ type: "notice", kind: "max_steps" });
    expect(finished[0].runStatus).toBe("COMPLETED");
  });

  it("re-checks spend limits before later steps and cancels children when blocked", async () => {
    const echo = echoTool();
    let allowed = true;
    const watcher = new FakeWatcher();
    const { start, upstream, finished } = setup([[...call("fc1", "c1", "echo", { value: "x" }), completed], [completed]], {
      tools: new ToolSet([echo.def]),
      watcher,
      gate: () => {
        const ok = allowed;
        allowed = false;
        return ok;
      },
    });
    allowed = false;
    await start().completion;
    expect(upstream.bodies).toHaveLength(1);
    expect(finished[0].error).toBe("Over your limit.");
    expect(finished[0].parts.map((p) => p.type)).toContain("notice");
    expect(watcher.cancelled).toHaveLength(1);
  });

  it("stop during tools aborts the tool, marks the run STOPPED and leaves no dangling calls", async () => {
    let started = false;
    const blocker = defineTool({
      name: "block",
      description: "",
      schema: z.object({}),
      available: () => true,
      execute: (_a, ctx) =>
        new Promise((resolve) => {
          started = true;
          ctx.signal.addEventListener("abort", () => resolve({ output: "aborted", aborted: true }));
        }),
    });
    const { manager, start, finished } = setup([[...call("fc1", "c1", "block", {}), completed]], { tools: new ToolSet([blocker]) });
    const { completion } = start();
    await until(() => started);
    manager.stop("run1");
    await completion;
    expect(finished[0].runStatus).toBe("STOPPED");
    expect(finished[0].parts[0]).toMatchObject({ status: "cancelled" });
    const items = finished[0].rawOutput.items;
    const calls = items.filter((i) => "type" in i && i.type === "function_call").length;
    const outputs = items.filter((i) => "type" in i && i.type === "function_call_output").length;
    expect(calls).toBe(outputs);
  });

  it("injects steering messages at the next step boundary", async () => {
    let release!: () => void;
    const gateTool = defineTool({
      name: "wait",
      description: "",
      schema: z.object({}),
      available: () => true,
      execute: () => new Promise((r) => (release = () => r({ output: "ok" }))),
    });
    const { manager, start, upstream, finished, events } = setup(
      [[...call("fc1", "c1", "wait", {}), completed], [...text("msg", "Got it"), completed]],
      { tools: new ToolSet([gateTool]) },
    );
    const { completion } = start();
    await until(() => !!release);
    expect(manager.steer("run1", { id: "s1", text: "also do Y", at: 1 })).toEqual({ accepted: true });
    expect(events.some((e) => e.type === "steer_queue" && e.pending.length === 1)).toBe(true);
    release();
    await completion;
    const input2 = upstream.bodies[1].input as { role?: string; content?: unknown }[];
    expect(input2.at(-1)).toEqual({ role: "user", content: [{ type: "input_text", text: "also do Y" }] });
    expect(finished[0].parts.map((p) => p.type)).toEqual(["tool", "steer", "text"]);
    expect(manager.steer("run1", { id: "s2", text: "late", at: 2 })).toEqual({ accepted: false });
  });

  it("a steer sent during the final step prevents the run from finishing", async () => {
    const { manager, start, upstream, finished } = setup(["hold", [...text("msg2", "Second"), completed]]);
    const { completion } = start();
    await until(() => upstream.bodies.length === 1);
    await tick();
    expect(manager.steer("run1", { id: "s1", text: "more", at: 1 }).accepted).toBe(true);
    upstream.release();
    await completion;
    expect(upstream.bodies).toHaveLength(2);
    expect(finished[0].parts.map((p) => p.type)).toEqual(["text", "steer", "text"]);
    expect(finished[0].finalText).toBe("Second");
  });

  it("interrupt keeps partial text, adds a notice, continues with queued steers and never cancels children", async () => {
    const watcher = new FakeWatcher();
    const { manager, start, upstream, finished, steps } = setup(["hang", [...text("msg2", "Continuing"), completed]], { watcher });
    const { completion } = start();
    await until(() => upstream.bodies.length === 1);
    await tick();
    manager.steer("run1", { id: "s1", text: "change course", at: 1 });
    expect(manager.interrupt("run1")).toBe(true);
    await completion;
    expect(watcher.cancelled).toHaveLength(0);
    const types = finished[0].parts.map((p) => p.type);
    expect(types).toEqual(["text", "notice", "steer", "text"]);
    expect(finished[0].parts[0]).toMatchObject({ text: "Partial" });
    expect(steps[0].usage).toBeNull();
    expect(steps[0].outcome).toBe("interrupted");
    const input2 = upstream.bodies[1].input as { role?: string; content?: unknown }[];
    expect(input2.slice(-2)).toEqual([
      { role: "assistant", content: "Partial" },
      { role: "user", content: [{ type: "input_text", text: "change course" }] },
    ]);
    expect(finished[0].runStatus).toBe("COMPLETED");
  });

  it("interrupt with nothing queued finishes the run instead of re-calling the model", async () => {
    const { manager, start, upstream, finished } = setup(["hang"]);
    const { completion } = start();
    await until(() => upstream.bodies.length === 1);
    await tick();
    manager.interrupt("run1");
    await completion;
    expect(upstream.bodies).toHaveLength(1);
    expect(finished[0].runStatus).toBe("COMPLETED");
  });

  it("waits for running sub-agents, then wakes the model with a task notification", async () => {
    const watcher = new FakeWatcher();
    watcher.running.add("task1");
    const { start, upstream, finished, events } = setup(
      [[...text("msg1", "Delegated."), completed], [...text("msg2", "Task 1 is done."), completed]],
      { watcher },
    );
    const { completion } = start();
    await until(() => events.some((e) => e.type === "phase" && e.phase === "waiting"));
    expect(upstream.bodies).toHaveLength(1);
    watcher.settle({ taskId: "task1", title: "Research", status: "COMPLETED", result: "Found it", error: null });
    await completion;
    expect(upstream.bodies).toHaveLength(2);
    const last = (upstream.bodies[1].input as { content?: { text?: string }[] }[]).at(-1);
    expect(last?.content?.[0]?.text).toContain('<task_notification task_id="task1"');
    expect(last?.content?.[0]?.text).toContain("Found it");
    const types = finished[0].parts.map((p) => p.type);
    expect(types).toEqual(["text", "waiting", "notice", "text"]);
    expect(finished[0].parts[1]).toMatchObject({ endedAt: expect.any(Number) });
    expect(finished[0].finalText).toBe("Task 1 is done.");
    expect(watcher.cancelled).toHaveLength(0);
  });

  it("batches settles that land during a step into one notification", async () => {
    const watcher = new FakeWatcher();
    watcher.running.add("a");
    watcher.running.add("b");
    let release!: () => void;
    const gateTool = defineTool({
      name: "wait",
      description: "",
      schema: z.object({}),
      available: () => true,
      execute: () => new Promise((r) => (release = () => r({ output: "ok" }))),
    });
    const { start, upstream, finished } = setup([[...call("fc1", "c1", "wait", {}), completed], [completed]], {
      tools: new ToolSet([gateTool]),
      watcher,
    });
    const { completion } = start();
    await until(() => !!release);
    watcher.settle({ taskId: "a", title: "A", status: "COMPLETED", result: "ra", error: null });
    watcher.settle({ taskId: "b", title: "B", status: "FAILED", result: null, error: "boom" });
    release();
    await completion;
    expect(upstream.bodies).toHaveLength(2);
    const text2 = (upstream.bodies[1].input as { content?: { text?: string }[] }[]).at(-1)?.content?.[0]?.text ?? "";
    expect(text2).toContain('task_id="a"');
    expect(text2).toContain('task_id="b"');
    expect(finished[0].parts.filter((p) => p.type === "notice").map((p) => p.type === "notice" && p.kind)).toEqual([
      "task_finished",
      "task_failed",
    ]);
  });

  it("stop while waiting cancels all children", async () => {
    const watcher = new FakeWatcher();
    watcher.running.add("task1");
    const { manager, start, finished, events } = setup([[...text("m", "Working on it"), completed]], { watcher });
    const { completion } = start();
    await until(() => events.some((e) => e.type === "phase" && e.phase === "waiting"));
    manager.stop("run1");
    await completion;
    expect(finished[0].runStatus).toBe("STOPPED");
    expect(watcher.cancelled).toHaveLength(1);
  });

  it("SSE replay mid-run reproduces the final parts", async () => {
    const echo = echoTool();
    const { manager, start, events } = setup(
      [[...text("m0", "Let me check."), ...call("fc1", "c1", "echo", { value: "x" }), completed], [...text("m1", "Done"), completed]],
      { tools: new ToolSet([echo.def]) },
    );
    await start().completion;
    const done = events.at(-1);
    if (done?.type !== "done") throw new Error();
    const replayed: RunEvent[] = [];
    manager.subscribe("run1", 0, (e) => replayed.push(e));
    expect(replay(replayed)).toEqual(done.parts);
  });
});
