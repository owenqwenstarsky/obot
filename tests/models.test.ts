import { describe, expect, it } from "vitest";
import { MODEL_METADATA, getModelMetadata, modelMetadataSchema } from "@/config/model-metadata";
import { capEfforts, effortLabel, resolveEffort } from "@/lib/efforts";
import { prettifyModelId, sortCatalog, toCatalogModel, type ModelRowLike } from "@/server/llm/catalog";

const row = (id: string, extra: Partial<ModelRowLike> = {}): ModelRowLike => ({
  id,
  ownedBy: null,
  enabled: true,
  available: true,
  displayNameOverride: null,
  contextWindowOverride: null,
  sortOrder: 0,
  ...extra,
});

describe("model metadata file", () => {
  it("validates against the schema and contains the three GPT-6 models", () => {
    for (const m of MODEL_METADATA) expect(() => modelMetadataSchema.parse(m)).not.toThrow();
    expect(MODEL_METADATA.map((m) => m.id)).toEqual(["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"]);
  });

  it("never exposes `max` reasoning", () => {
    for (const m of MODEL_METADATA) expect(m.reasoningEfforts).not.toContain("max");
  });

  it("Luna offers Disabled (none); Sol and Astra start at low", () => {
    expect(getModelMetadata("gpt-6-luna")!.reasoningEfforts).toEqual(["none", "low", "medium", "high", "xhigh"]);
    expect(getModelMetadata("gpt-6.1-sol")!.reasoningEfforts).toEqual(["low", "medium", "high", "xhigh"]);
    expect(getModelMetadata("gpt-6-astra")!.reasoningEfforts).toEqual(["low", "medium", "high", "xhigh"]);
    expect(effortLabel("none")).toBe("Disabled");
    expect(effortLabel("xhigh")).toBe("X-High");
  });

  it("records the published context window and limits", () => {
    for (const m of MODEL_METADATA) {
      expect(m.contextWindow).toBe(1_050_000);
      expect(m.maxInputTokens).toBe(922_000);
      expect(m.maxOutputTokens).toBe(128_000);
    }
  });
});

describe("efforts", () => {
  it("capEfforts drops max and unknown values, keeping ascending order", () => {
    expect(capEfforts(["max", "high", "low", "bogus", "xhigh", "low"])).toEqual(["low", "high", "xhigh"]);
  });

  it("resolveEffort falls back sensibly", () => {
    expect(resolveEffort("max", ["low", "medium", "high", "xhigh"])).toBe("medium");
    expect(resolveEffort("none", ["low", "medium"])).toBe("medium");
    expect(resolveEffort("high", ["low", "high"])).toBe("high");
    expect(resolveEffort(null, ["low", "high"], "high")).toBe("high");
    expect(resolveEffort("low", [])).toBeNull();
  });
});

describe("catalog merge", () => {
  it("uses metadata for known models and respects admin overrides", () => {
    const m = toCatalogModel(row("gpt-6-luna", { displayNameOverride: "Luna", contextWindowOverride: 500_000 }), true);
    expect(m).toMatchObject({
      displayName: "Luna",
      contextWindow: 500_000,
      hasMetadata: true,
      hasPrice: true,
      supportsImageInput: true,
      supportsWebSearch: true,
      defaultEffort: "medium",
    });
    expect(m.efforts).toContain("none");
  });

  it("gives unknown OpenAI-style models generic defaults", () => {
    const m = toCatalogModel(row("gpt-5.5-mini"), false);
    expect(m).toMatchObject({
      displayName: "GPT-5.5 Mini",
      contextWindow: null,
      efforts: ["low", "medium", "high", "xhigh"],
      supportsWebSearch: true,
      supportsImageInput: false,
      hasMetadata: false,
    });
  });

  it("gives unknown non-OpenAI models no reasoning or web search", () => {
    const m = toCatalogModel(row("claude-something", { ownedBy: "anthropic" }), false);
    expect(m.efforts).toEqual([]);
    expect(m.supportsReasoning).toBe(false);
    expect(m.supportsWebSearch).toBe(false);
  });

  it("sorts metadata models first", () => {
    const sorted = sortCatalog([toCatalogModel(row("aaa"), false), toCatalogModel(row("gpt-6-luna"), false)]);
    expect(sorted[0].id).toBe("gpt-6-luna");
  });

  it("prettifies ids", () => {
    expect(prettifyModelId("gpt-6-luna")).toBe("GPT-6 Luna");
  });
});
