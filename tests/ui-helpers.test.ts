import { describe, expect, it } from "vitest";
import { canonicalUrl, injectCitationLinks, uniqueSources } from "@/lib/citations";
import { groupThreads } from "@/lib/thread-groups";
import { customRange, daysBetween, presetRange } from "@/lib/date-ranges";
import { assignSeries, orderModels } from "@/lib/series-colors";

describe("citations", () => {
  it("leaves spans that already link to the cited URL untouched", () => {
    const text = "Obot shipped ([example.com](https://example.com/a?utm_source=openai)).";
    const out = injectCitationLinks(text, [{ url: "https://example.com/a?utm_source=openai", start: 13, end: 69 }]);
    expect(out).toBe(text);
  });

  it("inserts a compact link at the end of an unlinked cited span", () => {
    const text = "Obot shipped. More text.";
    const out = injectCitationLinks(text, [{ url: "https://news.example.org/x", start: 0, end: 13 }]);
    expect(out).toBe("Obot shipped. ([news.example.org](https://news.example.org/x)) More text.");
  });

  it("dedupes sources by canonical URL in order of appearance", () => {
    const s = uniqueSources([
      { url: "https://b.com/?utm_source=openai", start: 10, end: 12 },
      { url: "https://a.com", start: 0, end: 2 },
      { url: "https://b.com", start: 20, end: 22 },
    ]);
    expect(s.map((x) => x.url)).toEqual(["https://a.com", "https://b.com/?utm_source=openai"]);
    expect(canonicalUrl("https://b.com/?utm_source=openai")).toBe("https://b.com");
  });
});

describe("groupThreads", () => {
  it("buckets by recency with pinned first", () => {
    const now = new Date(2026, 10, 2, 15, 0, 0);
    const t = (id: string, d: Date, pinned = false) => ({ id, pinned, lastMessageAt: d.toISOString() });
    const groups = groupThreads(
      [
        t("today", new Date(2026, 10, 2, 9)),
        t("yday", new Date(2026, 10, 1, 23)),
        t("week", new Date(2026, 9, 29)),
        t("month", new Date(2026, 9, 10)),
        t("old", new Date(2025, 0, 1)),
        t("pin", new Date(2025, 0, 1), true),
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Pinned", ["pin"]],
      ["Today", ["today"]],
      ["Yesterday", ["yday"]],
      ["Last 7 days", ["week"]],
      ["Last 30 days", ["month"]],
      ["Older", ["old"]],
    ]);
  });
});

describe("date ranges", () => {
  const now = new Date(2026, 10, 4, 13, 30); // Wed Nov 4 2026 local
  it("computes half-open preset ranges in local time", () => {
    expect(presetRange("today", now)).toEqual({ from: new Date(2026, 10, 4), to: new Date(2026, 10, 5) });
    expect(presetRange("this_week", now).from).toEqual(new Date(2026, 10, 2)); // Monday
    expect(presetRange("last_month", now)).toEqual({ from: new Date(2026, 9, 1), to: new Date(2026, 10, 1) });
    expect(presetRange("last_7", now).from).toEqual(new Date(2026, 9, 29));
    expect(presetRange("all", now)).toEqual({ from: null, to: null });
  });

  it("custom ranges are inclusive of both days and order-independent", () => {
    expect(customRange(new Date(2026, 0, 5), new Date(2026, 0, 3))).toEqual({ from: new Date(2026, 0, 3), to: new Date(2026, 0, 6) });
    expect(daysBetween(new Date(2026, 0, 3), new Date(2026, 0, 6))).toEqual(["2026-01-03", "2026-01-04", "2026-01-05"]);
  });
});

describe("series colors", () => {
  it("orders metadata models first so colors are stable across filters", () => {
    expect(orderModels(["zeta", "gpt-6-luna", "alpha", "gpt-6.1-sol"])).toEqual(["gpt-6.1-sol", "gpt-6-luna", "alpha", "zeta"]);
    const a = assignSeries(["gpt-6-luna", "alpha"]);
    const b = assignSeries(["alpha", "gpt-6.1-sol", "gpt-6-luna", "beta"]);
    const luna = (x: ReturnType<typeof assignSeries>) => x.find((s) => s.key === "gpt-6-luna")?.color;
    expect(luna(a)).toBe("var(--series-3)");
    expect(luna(b)).toBe("var(--series-3)");
    expect(a.find((s) => s.key === "alpha")?.color).toBe("var(--series-1)");
  });

  it("folds series beyond eight into Other", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `m${i}`);
    const s = assignSeries(ids);
    expect(s).toHaveLength(8);
    expect(s.at(-1)).toMatchObject({ key: "__other", members: ["m7", "m8", "m9"] });
  });
});

describe("stripCitationParens", () => {
  it("removes parentheses around cited links only", async () => {
    const { stripCitationParens } = await import("@/lib/citations");
    const cites = [{ url: "https://github.com/x?utm_source=openai", start: 0, end: 0 }];
    expect(stripCitationParens("Done ([github.com](https://github.com/x?utm_source=openai)).", cites)).toBe(
      "Done [github.com](https://github.com/x?utm_source=openai).",
    );
    expect(stripCitationParens("See ([other](https://other.com)).", cites)).toBe("See ([other](https://other.com)).");
  });
});

describe("prettifyModelId", () => {
  it("drops provider prefixes and joins version numbers", async () => {
    const { prettifyModelId } = await import("@/server/llm/catalog");
    expect(prettifyModelId("apifan/claude-opus-4-6")).toBe("Claude Opus 4.6");
    expect(prettifyModelId("gpt-5.5-mini")).toBe("GPT-5.5 Mini");
    expect(prettifyModelId("gpt-6-luna")).toBe("GPT-6 Luna");
  });
});
