import { describe, expect, it } from "vitest";
import { RunManager, type RunFinish } from "@/server/agent/run-manager";
import type { StreamEvent } from "@/server/llm/stream-normalizer";
import type { RunEvent } from "@/lib/run-events";
import { applyPartOps } from "@/lib/part-ops";
import type { MessagePart } from "@/lib/parts";

/** A controllable fake upstream stream. */
function fakeStream() {
  const queue: (StreamEvent | Error | null)[] = [];
  let wake: (() => void) | null = null;
  const push = (e: StreamEvent | Error | null) => {
    queue.push(e);
    wake?.();
  };
  const iterable = (signal: AbortSignal): AsyncIterable<StreamEvent> => ({
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (signal.aborted) throw new Error("aborted");
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            wake = r;
            signal.addEventListener("abort", () => r(), { once: true });
          });
          wake = null;
          continue;
        }
        const next = queue.shift()!;
        if (next === null) return;
        if (next instanceof Error) throw next;
        yield next;
      }
    },
  });
  return { push, iterable };
}

function setup() {
  const upstream = fakeStream();
  const saved: MessagePart[][] = [];
  const finished: RunFinish[] = [];
  let t = 0;
  const manager = new RunManager({
    openStream: async (_body, signal) => upstream.iterable(signal),
    saveProgress: async (_id, parts) => {
      saved.push(parts);
    },
    recordStep: async () => ({ costMicros: 1234 }),
    finish: async (r) => {
      finished.push(r);
    },
    now: () => (t += 600),
    flushIntervalMs: 1000,
    retainMs: 10_000,
  });
  const start = () =>
    manager.start({ runId: "run1", threadId: "t1", userId: "u1", messageId: "m1", modelId: "gpt-6-luna", effort: "low", body: {} });
  return { manager, upstream, saved, finished, start };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };

describe("RunManager", () => {
  it("streams ops to subscribers and finishes with usage", async () => {
    const { manager, upstream, finished, start } = setup();
    const { completion } = start();
    const events: RunEvent[] = [];
    manager.subscribe("run1", 0, (e) => events.push(e));

    upstream.push({ type: "response.output_item.added", item: { id: "msg", type: "message" } });
    upstream.push({ type: "response.output_text.delta", item_id: "msg", delta: "Hi" });
    upstream.push({ type: "response.completed", response: { id: "resp", usage } });
    upstream.push(null);
    await completion;

    const done = events.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type !== "done") throw new Error();
    expect(done.runStatus).toBe("COMPLETED");
    expect(done.costMicros).toBe(1234);
    expect(done.parts).toEqual([{ type: "text", id: "msg", text: "Hi", citations: [] }]);
    expect(finished[0]).toMatchObject({ runStatus: "COMPLETED", messageStatus: "COMPLETE", responseId: "resp" });
    expect(finished[0].usage?.totalTokens).toBe(15);

    // Ops replayed client-side produce the same parts.
    let parts: MessagePart[] = [];
    for (const e of events) if (e.type === "ops") parts = applyPartOps(parts, e.ops);
    expect(parts).toEqual(done.parts);
    expect(manager.isLive("run1")).toBe(false);
  });

  it("replays only events after the given seq to late subscribers", async () => {
    const { manager, upstream, start } = setup();
    const { completion } = start();
    upstream.push({ type: "response.output_item.added", item: { id: "msg", type: "message" } });
    upstream.push({ type: "response.output_text.delta", item_id: "msg", delta: "A" });
    upstream.push({ type: "response.output_text.delta", item_id: "msg", delta: "B" });
    await tick();
    await tick();

    const all: RunEvent[] = [];
    manager.subscribe("run1", 0, (e) => all.push(e));
    const lastSeq = all.at(-1)!.seq;
    expect(lastSeq).toBeGreaterThanOrEqual(2);

    const late: RunEvent[] = [];
    manager.subscribe("run1", lastSeq - 1, (e) => late.push(e));
    expect(late.map((e) => e.seq)).toEqual([lastSeq]);

    upstream.push({ type: "response.completed", response: { usage } });
    upstream.push(null);
    await completion;
    expect(late.at(-1)?.type).toBe("done");
    // Subscribing after completion still replays everything (within retention).
    const after: RunEvent[] = [];
    manager.subscribe("run1", 0, (e) => after.push(e));
    expect(after.at(-1)?.type).toBe("done");
  });

  it("stop keeps partial content and marks the run STOPPED", async () => {
    const { manager, upstream, finished, start } = setup();
    const { completion } = start();
    upstream.push({ type: "response.output_item.added", item: { id: "rs", type: "reasoning" } });
    upstream.push({ type: "response.output_item.added", item: { id: "msg", type: "message" } });
    upstream.push({ type: "response.output_text.delta", item_id: "msg", delta: "Partial answer" });
    await tick();
    await tick();
    expect(manager.stop("run1")).toBe(true);
    await completion;
    expect(finished[0].runStatus).toBe("STOPPED");
    expect(finished[0].messageStatus).toBe("STOPPED");
    expect(finished[0].parts.find((p) => p.type === "text")).toMatchObject({ text: "Partial answer" });
    expect(finished[0].usage).toBeNull();
    expect(manager.stop("run1")).toBe(false);
  });

  it("upstream errors produce a FAILED run with an error part", async () => {
    const { upstream, finished, start } = setup();
    const { completion } = start();
    upstream.push(Object.assign(new Error("boom"), { status: 500 }));
    await completion;
    expect(finished[0].runStatus).toBe("FAILED");
    expect(finished[0].error).toContain("500");
    expect(finished[0].parts.at(-1)).toMatchObject({ type: "error" });
  });

  it("a stream ending without a terminal event is treated as a failure", async () => {
    const { upstream, finished, start } = setup();
    const { completion } = start();
    upstream.push({ type: "response.output_item.added", item: { id: "msg", type: "message" } });
    upstream.push(null);
    await completion;
    expect(finished[0].runStatus).toBe("FAILED");
  });

  it("throttles part persistence while streaming", async () => {
    const { upstream, saved, start } = setup();
    const { completion } = start();
    for (let i = 0; i < 6; i++) upstream.push({ type: "response.output_text.delta", item_id: "msg", delta: `${i}` });
    upstream.push({ type: "response.completed", response: { usage } });
    upstream.push(null);
    await completion;
    // Clock advances 600ms per call; with a 1000ms interval only some deltas trigger a flush.
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.length).toBeLessThan(6);
  });

  it("publishes out-of-band title events to live subscribers", async () => {
    const { manager, upstream, start } = setup();
    const { completion } = start();
    const events: RunEvent[] = [];
    manager.subscribe("run1", 0, (e) => events.push(e));
    manager.publish("run1", { type: "title", threadId: "t1", title: "Hello" });
    upstream.push({ type: "response.completed", response: { usage } });
    upstream.push(null);
    await completion;
    expect(events.find((e) => e.type === "title")).toMatchObject({ title: "Hello" });
  });
});
