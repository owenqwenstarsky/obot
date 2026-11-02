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

export type FunctionToolStatus = "streaming_args" | "pending" | "running" | "completed" | "failed" | "cancelled";

export type SubagentTaskStatusValue = "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED";
export type ArtifactKindValue = "markdown" | "html" | "react";

/** Tool-specific final UI payload attached to a function tool part. */
export type ToolDisplay =
  | {
      kind: "bash";
      command: string;
      exitCode: number;
      stdout: string;
      stderr: string;
      truncated: boolean;
    }
  | { kind: "write_file"; path: string; bytes: number }
  | {
      kind: "artifact";
      artifactId: string;
      version: number;
      title: string;
      artifactKind: ArtifactKindValue;
    }
  | {
      kind: "subagent";
      taskId: string;
      childThreadId: string;
      title: string;
      modelId: string;
      status: SubagentTaskStatusValue;
    }
  | { kind: "json"; value: unknown };

/** A locally executed function tool call (sandbox, artifacts, sub-agents, ...). */
export type FunctionToolPart = {
  type: "tool";
  tool: "function";
  id: string;
  callId: string;
  name: string;
  status: FunctionToolStatus;
  /** Raw JSON arguments as streamed by the model; renderers may partially parse it. */
  argsText: string;
  /** Live progress output (append-only). */
  log?: string;
  display?: ToolDisplay;
  error?: string;
  startedAt: number;
  endedAt?: number;
};

/** A message the user sent into a running turn. Rendered as a user bubble inside the assistant reply. */
export type SteerPart = { type: "steer"; id: string; text: string; at: number };

export type NoticeKind =
  | "task_finished"
  | "task_failed"
  | "task_cancelled"
  | "interrupted"
  | "limit_reached"
  | "max_steps";

export type NoticePart = {
  type: "notice";
  id: string;
  at: number;
  kind: NoticeKind;
  taskId?: string;
  childThreadId?: string;
  title?: string;
  message?: string;
};

/** The runtime is waiting on running sub-agents. */
export type WaitingPart = { type: "waiting"; id: string; taskIds: string[]; startedAt: number; endedAt?: number };

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
  | FunctionToolPart
  | SteerPart
  | NoticePart
  | WaitingPart
  | ErrorPart
  | UserTextPart
  | UserImagePart;

export type ToolPart = WebSearchPart | GenericToolPart | FunctionToolPart;

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

export function addUsage(a: UsageSnapshot | null, b: UsageSnapshot | null): UsageSnapshot | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

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
