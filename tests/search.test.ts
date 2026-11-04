import { describe, expect, it } from "vitest";
import { buildPrefixTsQuery, HIGHLIGHT_END as E, HIGHLIGHT_START as S, splitHighlights } from "@/lib/search-query";
import { partsToSearchText, SEARCH_TEXT_CHARS, type MessagePart } from "@/lib/parts";

describe("buildPrefixTsQuery", () => {
  it("builds a prefix AND query from words", () => {
    expect(buildPrefixTsQuery("Rust async")).toBe("rust:* & async:*");
    expect(buildPrefixTsQuery("  café-au-lait  ")).toBe("café:* & au:* & lait:*");
    expect(buildPrefixTsQuery("数据 分析")).toBe("数据:* & 分析:*");
  });

  it("strips tsquery operators so input can't break the syntax", () => {
    expect(buildPrefixTsQuery("a & | ! ( ) : * ' \\ b")).toBe("a:* & b:*");
    expect(buildPrefixTsQuery("!!! ***")).toBeNull();
    expect(buildPrefixTsQuery("")).toBeNull();
  });

  it("caps the number of terms", () => {
    expect(buildPrefixTsQuery("a b c d e f g h i j k")?.split(" & ")).toHaveLength(8);
  });
});

describe("splitHighlights", () => {
  it("splits matched and plain segments", () => {
    expect(splitHighlights(`the ${S}quick${E} brown ${S}fox${E}`)).toEqual([
      { text: "the ", match: false },
      { text: "quick", match: true },
      { text: " brown ", match: false },
      { text: "fox", match: true },
    ]);
  });

  it("merges adjacent matches and tolerates unbalanced markers", () => {
    expect(splitHighlights(`${S}a${E}${S}b${E} c ${S}d`)).toEqual([
      { text: "ab", match: true },
      { text: " c ", match: false },
      { text: "d", match: true },
    ]);
    expect(splitHighlights("plain")).toEqual([{ text: "plain", match: false }]);
  });
});

describe("partsToSearchText", () => {
  it("indexes user text, replies, and steering only", () => {
    const parts: MessagePart[] = [
      { type: "user_text", id: "u", text: "Question?" },
      { type: "reasoning", id: "r", summary: "secret thoughts", startedAt: 0 },
      { type: "text", id: "t", text: " Answer. ", citations: [] },
      { type: "steer", id: "s", text: "also this", at: 0 },
      { type: "error", id: "e", message: "boom" },
    ];
    expect(partsToSearchText(parts)).toBe("Question?\n\nAnswer.\n\nalso this");
    expect(partsToSearchText([])).toBeNull();
  });

  it("caps very long text", () => {
    const parts: MessagePart[] = [{ type: "text", id: "t", text: "x".repeat(SEARCH_TEXT_CHARS + 10), citations: [] }];
    expect(partsToSearchText(parts)?.length).toBe(SEARCH_TEXT_CHARS);
  });
});
