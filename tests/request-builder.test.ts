import { describe, expect, it } from "vitest";
import { buildResponsesRequest, normalizeDomains, type HistoryMessage } from "@/server/llm/request-builder";

const history: HistoryMessage[] = [
  {
    role: "USER",
    parts: [
      { type: "user_image", id: "i1", attachmentId: "att_1", mime: "image/png" },
      { type: "user_text", id: "t1", text: "What is this?" },
    ],
  },
  {
    role: "ASSISTANT",
    parts: [
      { type: "reasoning", id: "r", summary: "hmm", startedAt: 0, endedAt: 1 },
      { type: "tool", tool: "web_search", id: "w", status: "completed", actions: [], sources: [], startedAt: 0 },
      { type: "text", id: "m", text: "A cat.", citations: [] },
    ],
  },
  { role: "ASSISTANT", parts: [{ type: "error", id: "e", message: "boom" }] },
  { role: "USER", parts: [{ type: "user_text", id: "t2", text: "And this?" }, { type: "user_image", id: "i2", attachmentId: "gone", mime: "image/png" }] },
];

const base = {
  model: "gpt-6-luna",
  history,
  resolveImage: (id: string) => (id === "att_1" ? "data:image/png;base64,AAA" : null),
  webSearch: { enabled: false, contextSize: "medium" as const, allowedDomains: [] },
  supportsReasoning: true,
};

describe("buildResponsesRequest", () => {
  it("replays history as user content + assistant text only", () => {
    const body = buildResponsesRequest({ ...base, effort: "medium" });
    expect(body.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_image", image_url: "data:image/png;base64,AAA", detail: "auto" },
          { type: "input_text", text: "What is this?" },
        ],
      },
      { role: "assistant", content: "A cat." },
      {
        role: "user",
        content: [
          { type: "input_text", text: "And this?" },
          { type: "input_text", text: "[An image was attached here but is no longer available.]" },
        ],
      },
    ]);
    expect(body.stream).toBe(true);
    expect(body.store).toBe(false);
  });

  it("requests reasoning summaries, except when reasoning is disabled", () => {
    expect(buildResponsesRequest({ ...base, effort: "xhigh" }).reasoning).toEqual({ effort: "xhigh", summary: "auto" });
    expect(buildResponsesRequest({ ...base, effort: "none" }).reasoning).toEqual({ effort: "none" });
    expect(buildResponsesRequest({ ...base, effort: "high", supportsReasoning: false }).reasoning).toBeUndefined();
    expect(buildResponsesRequest({ ...base, effort: null }).reasoning).toBeUndefined();
  });

  it("omits tools when web search is off", () => {
    const body = buildResponsesRequest({ ...base, effort: "low" });
    expect(body.tools).toBeUndefined();
    expect(body.include).toBeUndefined();
  });

  it("adds the web_search tool, sources include, and domain filters when on", () => {
    const body = buildResponsesRequest({
      ...base,
      effort: "low",
      webSearch: { enabled: true, contextSize: "high", allowedDomains: ["https://www.WHO.int/path", "cdc.gov", "cdc.gov"] },
    });
    expect(body.tools).toEqual([
      { type: "web_search", search_context_size: "high", filters: { allowed_domains: ["www.who.int", "cdc.gov"] } },
    ]);
    expect(body.include).toEqual(["web_search_call.action.sources"]);

    const noFilter = buildResponsesRequest({ ...base, effort: "low", webSearch: { enabled: true, contextSize: "low", allowedDomains: [] } });
    expect(noFilter.tools).toEqual([{ type: "web_search", search_context_size: "low" }]);
  });

  it("sets instructions from the system prompt when present", () => {
    expect(buildResponsesRequest({ ...base, effort: "low", systemPrompt: "  Be brief.  " }).instructions).toBe("Be brief.");
    expect(buildResponsesRequest({ ...base, effort: "low", systemPrompt: "   " }).instructions).toBeUndefined();
  });

  it("normalizeDomains caps at 100 entries", () => {
    const many = Array.from({ length: 150 }, (_, i) => `d${i}.com`);
    expect(normalizeDomains(many)).toHaveLength(100);
  });
});
