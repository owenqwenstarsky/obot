/**
 * Normalized message parts. The server converts raw Responses API stream events into
 * these shapes so the UI never needs to understand provider JSON.
 */

export type Citation = {
  url: string;
  title?: string;
  /** Character offsets into the text part (from url_citation annotations). */
  start: number;
  end: number;
};

export type TextPart = {
  type: "text";
  id: string;
  text: string;
  citations: Citation[];
};

export type ReasoningPart = {
  type: "reasoning";
  id: string;
  summary: string;
  startedAt: number;
  endedAt?: number;
};

export type WebSearchAction =
  | { kind: "search"; queries: string[] }
  | { kind: "open_page"; url?: string }
  | { kind: "find_in_page"; url?: string; pattern?: string };

export type WebSearchStatus = "in_progress" | "searching" | "completed" | "failed" | "incomplete";

export type WebSearchPart = {
  type: "tool";
  tool: "web_search";
  id: string;
  status: WebSearchStatus;
  actions: WebSearchAction[];
  sources: { url: string; title?: string }[];
  startedAt: number;
  endedAt?: number;
};

/** Fallback for tool item types the UI doesn't have a dedicated renderer for yet. */
export type GenericToolPart = {
  type: "tool";
  tool: "generic";
  id: string;
  itemType: string;
  status: string;
  raw: unknown;
};

export type ErrorPart = {
  type: "error";
  id: string;
  message: string;
};

export type UserTextPart = { type: "user_text"; id: string; text: string };
export type UserImagePart = { type: "user_image"; id: string; attachmentId: string; mime: string };

export type MessagePart =
  | TextPart
  | ReasoningPart
  | WebSearchPart
  | GenericToolPart
  | ErrorPart
  | UserTextPart
  | UserImagePart;

export type ToolPart = WebSearchPart | GenericToolPart;

export type UsageSnapshot = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

/** Stored on Thread.lastContext and sent to the context indicator. */
export type ContextSnapshot = UsageSnapshot & {
  modelId: string;
  at: string;
};

export function emptyUsage(): UsageSnapshot {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

/** Plain-text view of an assistant message (used for copy + history replay). */
export function partsToText(parts: MessagePart[]): string {
  return parts
    .filter((p): p is TextPart | UserTextPart => p.type === "text" || p.type === "user_text")
    .map((p) => p.text)
    .join("\n\n");
}
