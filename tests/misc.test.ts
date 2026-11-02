import { describe, expect, it } from "vitest";
import { sniffImageType } from "@/server/uploads/image-type";
import { cleanTitle, fallbackTitle } from "@/server/agent/title-text";
import { usageCsv } from "@/server/usage-csv";
import { applyPartOps } from "@/lib/part-ops";
import { formatTokens } from "@/lib/money";

describe("sniffImageType", () => {
  it("detects by magic bytes, not extension", () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new TextEncoder().encode("GIF89a...."))).toBe("image/gif");
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns="))).toBeNull();
  });
});

describe("titles", () => {
  it("cleans model output", () => {
    expect(cleanTitle('"Planning a Trip to Kyoto."\nextra')).toBe("Planning a Trip to Kyoto");
    expect(cleanTitle("Title: Rust lifetimes")).toBe("Rust lifetimes");
  });
  it("falls back to the first message", () => {
    expect(fallbackTitle("  hello   world ")).toBe("hello world");
    expect(fallbackTitle("x".repeat(100))).toHaveLength(58);
    expect(fallbackTitle("")).toBe("New thread");
  });
});

describe("usageCsv", () => {
  it("escapes cells and formats dollars", () => {
    const csv = usageCsv([
      {
        createdAt: "2026-11-02T00:00:00.000Z",
        userEmail: "a@b.c",
        kind: "CHAT",
        modelId: "gpt-6-luna",
        effort: "low",
        inputTokens: 1,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 2,
        reasoningTokens: 0,
        totalTokens: 3,
        webSearchCalls: 0,
        costMicros: 1500,
        priced: true,
        threadId: null,
        note: 'has, "comma"',
      },
    ]);
    const [, line] = csv.trim().split("\n");
    expect(line).toContain("0.001500");
    expect(line.endsWith('"has, ""comma"""')).toBe(true);
  });
});

describe("applyPartOps", () => {
  it("ignores appends to mismatched part types", () => {
    const parts = applyPartOps([], [{ op: "upsert", index: 0, part: { type: "error", id: "e", message: "x" } }]);
    expect(applyPartOps(parts, [{ op: "append_text", index: 0, delta: "y" }])).toEqual(parts);
  });
});

describe("formatTokens", () => {
  it("abbreviates", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_345)).toBe("12.3K");
    expect(formatTokens(1_050_000)).toBe("1.05M");
  });
});
