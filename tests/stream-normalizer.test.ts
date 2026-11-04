import { describe, expect, it } from "vitest";
import { ResponseStreamNormalizer, parseUsage, type StreamEvent } from "@/server/llm/stream-normalizer";
import { applyPartOps } from "@/lib/part-ops";
import type { MessagePart } from "@/lib/parts";

function clock() {
  let t = 1000;
  return () => (t += 100);
}

/** Feed events and also replay the emitted ops client-side to make sure both views agree. */
function run(events: StreamEvent[]) {
  const n = new ResponseStreamNormalizer(clock());
  let clientParts: MessagePart[] = [];
  for (const e of events) clientParts = applyPartOps(clientParts, n.apply(e));
  return { snap: n.snapshot(), clientParts, n };
}

const usage = {
  input_tokens: 1200,
  input_tokens_details: { cached_tokens: 200, cache_write_tokens: 0 },
  output_tokens: 300,
  output_tokens_details: { reasoning_tokens: 120 },
  total_tokens: 1500,
};

describe("ResponseStreamNormalizer", () => {
  it("handles a plain text response", () => {
    const { snap, clientParts } = run([
      { type: "response.created", response: { id: "resp_1" } },
      { type: "response.output_item.added", item: { id: "msg_1", type: "message", content: [] } },
      { type: "response.output_text.delta", item_id: "msg_1", delta: "Hello" },
      { type: "response.output_text.delta", item_id: "msg_1", delta: ", world" },
      { type: "response.output_text.done", item_id: "msg_1", text: "Hello, world" },
      {
        type: "response.output_item.done",
        item: { id: "msg_1", type: "message", content: [{ type: "output_text", text: "Hello, world", annotations: [] }] },
      },
      { type: "response.completed", response: { id: "resp_1", usage } },
    ]);
    expect(snap.status).toBe("completed");
    expect(snap.responseId).toBe("resp_1");
    expect(snap.parts).toEqual([{ type: "text", id: "msg_1", text: "Hello, world", citations: [] }]);
    expect(clientParts).toEqual(snap.parts);
    expect(snap.usage).toEqual({
      inputTokens: 1200,
      cachedInputTokens: 200,
      cacheWriteTokens: 0,
      outputTokens: 300,
      reasoningTokens: 120,
      totalTokens: 1500,
    });
    expect(snap.rawOutput).toHaveLength(1);
  });

  it("streams reasoning summaries, separating summary parts, then closes reasoning when text starts", () => {
    const { snap, clientParts } = run([
      { type: "response.output_item.added", item: { id: "rs_1", type: "reasoning", summary: [] } },
      { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 0, delta: "Thinking about it." },
      { type: "response.reasoning_summary_text.delta", item_id: "rs_1", summary_index: 1, delta: "Second idea." },
      { type: "response.output_item.added", item: { id: "msg_1", type: "message" } },
      { type: "response.output_text.delta", item_id: "msg_1", delta: "Answer" },
      { type: "response.completed", response: { usage } },
    ]);
    const reasoning = snap.parts[0];
    expect(reasoning.type).toBe("reasoning");
    if (reasoning.type !== "reasoning") throw new Error();
    expect(reasoning.summary).toBe("Thinking about it.\n\nSecond idea.");
    expect(reasoning.endedAt).toBeGreaterThan(reasoning.startedAt);
    expect(clientParts).toEqual(snap.parts);
  });

  it("tracks web search calls with search, open_page and find_in_page actions plus citations", () => {
    const { snap, clientParts } = run([
      { type: "response.output_item.added", item: { id: "ws_1", type: "web_search_call", status: "in_progress" } },
      { type: "response.web_search_call.in_progress", item_id: "ws_1" },
      { type: "response.web_search_call.searching", item_id: "ws_1" },
      { type: "response.web_search_call.completed", item_id: "ws_1" },
      {
        type: "response.output_item.done",
        item: {
          id: "ws_1",
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "obot release",
            queries: ["obot release", "obot changelog"],
            sources: [{ type: "url", url: "https://example.com/a", title: "A" }, { type: "url", url: "https://example.com/b" }],
          },
        },
      },
      {
        type: "response.output_item.done",
        item: { id: "ws_2", type: "web_search_call", status: "completed", action: { type: "open_page", url: "https://example.com/a" } },
      },
      {
        type: "response.output_item.done",
        item: {
          id: "ws_3",
          type: "web_search_call",
          status: "completed",
          action: { type: "find_in_page", url: "https://example.com/a", pattern: "version" },
        },
      },
      { type: "response.output_item.added", item: { id: "msg_1", type: "message" } },
      { type: "response.output_text.delta", item_id: "msg_1", delta: "See source." },
      {
        type: "response.output_text.annotation.added",
        item_id: "msg_1",
        annotation: { type: "url_citation", url: "https://example.com/a", title: "A", start_index: 0, end_index: 11 },
      },
      { type: "response.completed", response: { usage } },
    ]);

    const [ws1, ws2, ws3, text] = snap.parts;
    expect(ws1).toMatchObject({
      type: "tool",
      tool: "web_search",
      status: "completed",
      actions: [{ kind: "search", queries: ["obot release", "obot changelog"] }],
      sources: [{ url: "https://example.com/a", title: "A" }, { url: "https://example.com/b" }],
    });
    expect(ws2).toMatchObject({ actions: [{ kind: "open_page", url: "https://example.com/a" }] });
    expect(ws3).toMatchObject({ actions: [{ kind: "find_in_page", pattern: "version" }] });
    expect(text).toMatchObject({
      type: "text",
      text: "See source.",
      citations: [{ url: "https://example.com/a", title: "A", start: 0, end: 11 }],
    });
    // Only `search` actions are billable.
    expect(snap.webSearchCalls).toBe(1);
    expect(clientParts).toEqual(snap.parts);
  });

  it("reports failures and error events", () => {
    const failed = run([
      { type: "response.output_item.added", item: { id: "msg_1", type: "message" } },
      { type: "response.output_text.delta", item_id: "msg_1", delta: "Partial" },
      { type: "response.failed", response: { error: { message: "upstream exploded" } } },
    ]);
    expect(failed.snap.status).toBe("failed");
    expect(failed.snap.error).toBe("upstream exploded");
    expect(failed.snap.parts[0]).toMatchObject({ text: "Partial" });

    const errored = run([
      { type: "response.output_item.added", item: { id: "ws_1", type: "web_search_call", status: "searching" } },
      { type: "error", message: "rate limited" },
    ]);
    expect(errored.snap.status).toBe("failed");
    expect(errored.snap.error).toBe("rate limited");
    expect(errored.snap.parts[0]).toMatchObject({ status: "incomplete" });
  });

  it("marks incomplete responses with a reason", () => {
    const { snap } = run([
      { type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" }, usage } },
    ]);
    expect(snap.status).toBe("incomplete");
    expect(snap.incompleteReason).toBe("max_output_tokens");
  });

  it("falls back to a generic tool part for unknown item types and ignores unknown events", () => {
    const { snap } = run([
      { type: "response.some_future_event", foo: 1 },
      { type: "response.output_item.added", item: { id: "ci_1", type: "code_interpreter_call", status: "in_progress", name: "x" } },
      { type: "response.output_item.done", item: { id: "ci_1", type: "code_interpreter_call", status: "completed", name: "x" } },
      { type: "response.output_item.added" }, // malformed
      { type: "response.output_text.delta" }, // malformed
    ]);
    expect(snap.parts).toHaveLength(1);
    expect(snap.parts[0]).toMatchObject({ type: "tool", tool: "generic", itemType: "code_interpreter_call", status: "completed" });
  });

  it("recovers output from the final response when no item events were streamed", () => {
    const { snap, clientParts } = run([
      {
        type: "response.completed",
        response: {
          id: "resp_9",
          usage,
          output: [
            { id: "msg_9", type: "message", content: [{ type: "output_text", text: "Only final", annotations: [] }] },
          ],
        },
      },
    ]);
    expect(snap.parts).toEqual([{ type: "text", id: "msg_9", text: "Only final", citations: [] }]);
    expect(clientParts).toEqual(snap.parts);
  });

  it("finalizeOpenParts closes reasoning and in-flight searches", () => {
    const n = new ResponseStreamNormalizer(clock());
    n.apply({ type: "response.output_item.added", item: { id: "rs_1", type: "reasoning" } });
    n.apply({ type: "response.output_item.added", item: { id: "ws_1", type: "web_search_call", status: "searching" } });
    n.finalizeOpenParts();
    const [r, ws] = n.snapshot().parts;
    expect(r).toMatchObject({ type: "reasoning" });
    expect((r as { endedAt?: number }).endedAt).toBeDefined();
    expect(ws).toMatchObject({ status: "incomplete" });
  });

  it("parseUsage tolerates missing details", () => {
    expect(parseUsage({ input_tokens: 5, output_tokens: 7 })).toEqual({
      inputTokens: 5,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 7,
      reasoningTokens: 0,
      totalTokens: 12,
    });
    expect(parseUsage(null)).toBeNull();
  });
});

describe("ResponseStreamNormalizer function calls", () => {
  it("streams function call arguments and records completed calls", () => {
    const { snap, clientParts } = run([
      { type: "response.output_item.added", item: { id: "fc_1", type: "function_call", call_id: "call_1", name: "bash", arguments: "" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"comm' },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: 'and":"ls"}' },
      { type: "response.function_call_arguments.done", item_id: "fc_1", arguments: '{"command":"ls"}' },
      {
        type: "response.output_item.done",
        item: { id: "fc_1", type: "function_call", call_id: "call_1", name: "bash", arguments: '{"command":"ls"}', status: "completed" },
      },
      { type: "response.completed", response: { usage } },
    ]);
    expect(snap.parts[0]).toMatchObject({ type: "tool", tool: "function", callId: "call_1", name: "bash", status: "pending", argsText: '{"command":"ls"}' });
    expect(clientParts).toEqual(snap.parts);
    expect(snap.functionCalls).toEqual([{ itemId: "fc_1", callId: "call_1", name: "bash", arguments: '{"command":"ls"}', partIndex: 0 }]);
  });

  it("appends to a shared parts array with an id prefix and only finalizes its own parts", () => {
    const shared: MessagePart[] = [{ type: "reasoning", id: "old", summary: "", startedAt: 1 }];
    const n = new ResponseStreamNormalizer(clock(), { parts: shared, idPrefix: "s1_" });
    const ops = n.apply({ type: "response.output_item.added", item: { id: "msg", type: "message" } });
    expect(ops[0]).toMatchObject({ op: "upsert", index: 1 });
    n.apply({ type: "response.output_item.added", item: { id: "fc", type: "function_call", call_id: "c", name: "x" } });
    n.finalizeOpenParts();
    const snap = n.snapshot();
    expect(snap.stepPartStart).toBe(1);
    expect(shared[1].id).toBe("s1_msg");
    expect((shared[0] as { endedAt?: number }).endedAt).toBeUndefined();
    expect(shared[2]).toMatchObject({ status: "cancelled" });
    expect(snap.functionCalls).toEqual([]);
  });

  it("recovers function calls from a final-only response", () => {
    const { snap } = run([
      {
        type: "response.completed",
        response: { usage, output: [{ id: "fc", type: "function_call", call_id: "c9", name: "x", arguments: "{}" }] },
      },
    ]);
    expect(snap.functionCalls.map((c) => c.callId)).toEqual(["c9"]);
  });

  it("ignores text annotations attached to a function call item instead of orphaning the call", () => {
    const fc = { type: "function_call", id: "fc_1", call_id: "call_1", name: "create_artifact", arguments: "" };
    const annotation = { type: "url_citation", url: "https://example.com/a", title: "A", start_index: 10, end_index: 20 };
    const { snap, clientParts, n } = run([
      { type: "response.created", response: { id: "resp_fc" } },
      { type: "response.output_item.added", output_index: 0, item: fc },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"title":"T"' },
      { type: "response.output_text.annotation.added", item_id: "fc_1", annotation },
      { type: "response.output_text.done", item_id: "fc_1", text: "" },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: "}" },
      { type: "response.function_call_arguments.done", item_id: "fc_1", arguments: '{"title":"T"}' },
      { type: "response.output_item.done", output_index: 0, item: { ...fc, arguments: '{"title":"T"}' } },
      { type: "response.completed", response: { id: "resp_fc", usage } },
    ]);
    expect(snap.parts).toHaveLength(1);
    expect(snap.parts[0]).toMatchObject({ type: "tool", tool: "function", status: "pending", argsText: '{"title":"T"}' });
    expect(snap.functionCalls).toEqual([{ itemId: "fc_1", callId: "call_1", name: "create_artifact", arguments: '{"title":"T"}', partIndex: 0 }]);
    expect(n.finalizeOpenParts()).toEqual([]);
    expect(clientParts).toEqual(snap.parts);
  });
});
