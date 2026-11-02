import { describe, expect, it } from "vitest";
import {
  outputItemsToTranscript,
  replayTranscript,
  sanitizeForReplay,
  taskNotificationItem,
  truncateMiddle,
  type TranscriptItem,
} from "@/server/llm/transcript";
import { buildInput, buildResponsesRequest } from "@/server/llm/request-builder";

describe("transcript", () => {
  it("converts output items, stripping ids/status and dropping hosted items", () => {
    const items = outputItemsToTranscript(
      [
        { id: "rs", type: "reasoning", summary: [{ type: "summary_text", text: "think" }], encrypted_content: "ENC" },
        { id: "rs2", type: "reasoning", summary: [] },
        { id: "ws", type: "web_search_call", status: "completed" },
        { id: "fc", type: "function_call", call_id: "c1", name: "bash", arguments: '{"command":"ls"}', status: "completed" },
        { id: "m", type: "message", content: [{ type: "output_text", text: "Hi" }] },
      ],
      { keepReasoning: true },
    );
    expect(items).toEqual([
      { type: "reasoning", id: "rs", summary: [{ type: "summary_text", text: "think" }], encrypted_content: "ENC" },
      { type: "function_call", call_id: "c1", name: "bash", arguments: '{"command":"ls"}' },
      { role: "assistant", content: "Hi" },
    ]);
    expect(outputItemsToTranscript([{ id: "rs", type: "reasoning", encrypted_content: "x" }], { keepReasoning: false })).toEqual([]);
  });

  it("drops dangling calls, orphan outputs and trailing reasoning", () => {
    const items: TranscriptItem[] = [
      { type: "function_call", call_id: "a", name: "x", arguments: "{}" },
      { type: "function_call_output", call_id: "a", output: "ok" },
      { type: "function_call", call_id: "b", name: "x", arguments: "{}" },
      { type: "function_call_output", call_id: "zzz", output: "orphan" },
      { type: "reasoning", id: "r", summary: [], encrypted_content: "e" },
    ];
    expect(sanitizeForReplay(items)).toEqual(items.slice(0, 2));
  });

  it("strips reasoning and truncates outputs for past turns only", () => {
    const big = "x".repeat(20_000);
    const items: TranscriptItem[] = [
      { type: "reasoning", id: "r", summary: [], encrypted_content: "e" },
      { type: "function_call", call_id: "a", name: "x", arguments: "{}" },
      { type: "function_call_output", call_id: "a", output: big },
    ];
    const past = replayTranscript(items, { pastTurn: true });
    expect(past).toHaveLength(2);
    expect((past[1] as { output: string }).output.length).toBeLessThan(9_000);
    expect(replayTranscript(items, { pastTurn: false })).toHaveLength(3);
  });

  it("truncateMiddle keeps head and tail", () => {
    const s = `HEAD${"m".repeat(1000)}TAIL`;
    const t = truncateMiddle(s, 100);
    expect(t.startsWith("HEAD")).toBe(true);
    expect(t.endsWith("TAIL")).toBe(true);
    expect(t).toContain("characters omitted");
    expect(truncateMiddle("short", 100)).toBe("short");
  });

  it("formats task notifications", () => {
    const item = taskNotificationItem(
      [{ taskId: "t1", title: 'A "quoted" title', status: "FAILED", result: null, error: "boom" }],
      2,
    );
    const text = (item as { content: { text: string }[] }).content[0].text;
    expect(text).toContain('title="A &quot;quoted&quot; title"');
    expect(text).toContain('status="failed"');
    expect(text).toContain("Error: boom");
    expect(text).toContain("2 other sub-agent tasks are still running");
  });
});

describe("history replay", () => {
  it("replays v2 transcripts and falls back to text (with steers) for legacy rows", () => {
    const input = buildInput(
      [
        { role: "USER", parts: [{ type: "user_text", id: "u1", text: "hi" }] },
        {
          role: "ASSISTANT",
          parts: [{ type: "text", id: "t", text: "ignored when transcript exists", citations: [] }],
          transcript: {
            v: 2,
            items: [
              { type: "function_call", call_id: "c", name: "bash", arguments: "{}" },
              { type: "function_call_output", call_id: "c", output: "out" },
              { role: "assistant", content: "Result" },
            ],
          },
        },
        {
          role: "ASSISTANT",
          parts: [
            { type: "text", id: "a", text: "before", citations: [] },
            { type: "steer", id: "s", text: "steer!", at: 1 },
            { type: "text", id: "b", text: "after", citations: [] },
          ],
          transcript: [{ legacy: true }],
        },
      ],
      () => null,
    );
    expect(input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "hi" }] },
      { type: "function_call", call_id: "c", name: "bash", arguments: "{}" },
      { type: "function_call_output", call_id: "c", output: "out" },
      { role: "assistant", content: "Result" },
      { role: "assistant", content: "before" },
      { role: "user", content: [{ type: "input_text", text: "steer!" }] },
      { role: "assistant", content: "after" },
    ]);
  });

  it("requests encrypted reasoning only when asked and reasoning is on", () => {
    const base = {
      model: "m",
      history: [],
      resolveImage: () => null,
      webSearch: { enabled: false, contextSize: "medium" as const, allowedDomains: [] },
      supportsReasoning: true,
    };
    expect(buildResponsesRequest({ ...base, effort: "high", replayReasoning: true }).include).toEqual(["reasoning.encrypted_content"]);
    expect(buildResponsesRequest({ ...base, effort: "high" }).include).toBeUndefined();
    expect(buildResponsesRequest({ ...base, effort: "none", replayReasoning: true }).include).toBeUndefined();
  });
});
