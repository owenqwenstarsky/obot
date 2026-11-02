/** Pure merge of upstream model rows, the metadata file, and admin overrides. */
import { getModelMetadata } from "@/config/model-metadata";
import { capEfforts, GENERIC_EFFORTS, resolveEffort, type AllowedEffort } from "@/lib/efforts";

export type ModelRowLike = {
  id: string;
  ownedBy: string | null;
  enabled: boolean;
  available: boolean;
  displayNameOverride: string | null;
  contextWindowOverride: number | null;
  sortOrder: number;
};

export type CatalogModel = {
  id: string;
  displayName: string;
  description: string | null;
  ownedBy: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  knowledgeCutoff: string | null;
  efforts: AllowedEffort[];
  defaultEffort: AllowedEffort | null;
  supportsReasoning: boolean;
  supportsWebSearch: boolean;
  supportsImageInput: boolean;
  /** Local function tools (sandbox, artifacts, sub-agents). */
  supportsFunctionTools: boolean;
  /** Replay encrypted reasoning between tool calls (OpenAI-style reasoning models). */
  replayReasoning: boolean;
  longContextThreshold: number | null;
  hasMetadata: boolean;
  enabled: boolean;
  available: boolean;
  hasPrice: boolean;
  sortOrder: number;
};

/** Heuristic for models without metadata: OpenAI-style ids get reasoning + web search. */
export function looksLikeOpenAIModel(id: string, ownedBy: string | null): boolean {
  if (ownedBy && /openai|codex/i.test(ownedBy)) return true;
  return /^(gpt-|o\d|codex)/i.test(id);
}

/** "apifan/claude-opus-4-6" → "Claude Opus 4.6", "gpt-5.5-mini" → "GPT-5.5 Mini". */
export function prettifyModelId(id: string): string {
  const base = id.split("/").pop() || id;
  const words: string[] = [];
  for (const w of base.split(/[-_\s]+/).filter(Boolean)) {
    const prev = words[words.length - 1];
    // Join version fragments like "4-6" into "4.6".
    if (/^\d+$/.test(w) && prev && /^\d+(\.\d+)*$/.test(prev)) words[words.length - 1] = `${prev}.${w}`;
    else words.push(w);
  }
  return words
    .map((w) => (/^gpt$/i.test(w) ? "GPT" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/^GPT (\d)/, "GPT-$1");
}

export function toCatalogModel(row: ModelRowLike, hasPrice: boolean): CatalogModel {
  const meta = getModelMetadata(row.id);
  if (meta) {
    const efforts = capEfforts(meta.reasoningEfforts);
    return {
      id: row.id,
      displayName: row.displayNameOverride || meta.displayName,
      description: meta.description,
      ownedBy: row.ownedBy,
      contextWindow: row.contextWindowOverride ?? meta.contextWindow,
      maxOutputTokens: meta.maxOutputTokens,
      knowledgeCutoff: meta.knowledgeCutoff,
      efforts,
      defaultEffort: resolveEffort(meta.defaultEffort, efforts),
      supportsReasoning: efforts.length > 0,
      supportsWebSearch: meta.supportsWebSearch,
      supportsImageInput: meta.supportsImageInput,
      supportsFunctionTools: true,
      replayReasoning: efforts.length > 0,
      longContextThreshold: meta.longContextThresholdTokens,
      hasMetadata: true,
      enabled: row.enabled,
      available: row.available,
      hasPrice,
      sortOrder: row.sortOrder,
    };
  }
  const openaiLike = looksLikeOpenAIModel(row.id, row.ownedBy);
  const efforts = openaiLike ? [...GENERIC_EFFORTS] : [];
  return {
    id: row.id,
    displayName: row.displayNameOverride || prettifyModelId(row.id),
    description: null,
    ownedBy: row.ownedBy,
    contextWindow: row.contextWindowOverride,
    maxOutputTokens: null,
    knowledgeCutoff: null,
    efforts,
    defaultEffort: resolveEffort("medium", efforts),
    supportsReasoning: efforts.length > 0,
    supportsWebSearch: openaiLike,
    supportsImageInput: false,
    // CLIProxyAPI translates function tools for every upstream it supports.
    supportsFunctionTools: true,
    replayReasoning: openaiLike,
    longContextThreshold: null,
    hasMetadata: false,
    enabled: row.enabled,
    available: row.available,
    hasPrice,
    sortOrder: row.sortOrder,
  };
}

export function sortCatalog(models: CatalogModel[]): CatalogModel[] {
  return models.slice().sort((a, b) => {
    if (a.hasMetadata !== b.hasMetadata) return a.hasMetadata ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.displayName.localeCompare(b.displayName);
  });
}
