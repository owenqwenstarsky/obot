import type { Message, Thread } from "@/generated/prisma/client";
import type { ContextSnapshot, MessagePart } from "@/lib/parts";

export type ClientMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  parts: MessagePart[];
  modelId: string | null;
  effort: string | null;
  webSearch: boolean;
  status: "STREAMING" | "COMPLETE" | "STOPPED" | "ERROR";
  error: string | null;
  createdAt: string;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    webSearchCalls: number;
    costMicros: number;
    priced: boolean;
  } | null;
};

export type ClientThread = {
  id: string;
  title: string;
  pinned: boolean;
  webSearchEnabled: boolean | null;
  lastModelId: string | null;
  lastEffort: string | null;
  lastContext: ContextSnapshot | null;
  createdAt: string;
  lastMessageAt: string;
};

export type ClientThreadDetail = ClientThread & {
  spentMicros: number;
  messages: ClientMessage[];
  activeRun: { id: string; messageId: string | null } | null;
};

export type UsageLike = {
  messageId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  webSearchCalls: number;
  costMicros: bigint;
  priced: boolean;
};

export function serializeThread(t: Thread): ClientThread {
  return {
    id: t.id,
    title: t.title,
    pinned: t.pinned,
    webSearchEnabled: t.webSearchEnabled,
    lastModelId: t.lastModelId,
    lastEffort: t.lastEffort,
    lastContext: (t.lastContext as ContextSnapshot | null) ?? null,
    createdAt: t.createdAt.toISOString(),
    lastMessageAt: t.lastMessageAt.toISOString(),
  };
}

export function serializeMessage(m: Message, usage?: UsageLike | null): ClientMessage {
  return {
    id: m.id,
    role: m.role,
    parts: (Array.isArray(m.parts) ? m.parts : []) as unknown as MessagePart[],
    modelId: m.modelId,
    effort: m.effort,
    webSearch: m.webSearch,
    status: m.status,
    error: m.error,
    createdAt: m.createdAt.toISOString(),
    usage: usage
      ? {
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          outputTokens: usage.outputTokens,
          reasoningTokens: usage.reasoningTokens,
          totalTokens: usage.totalTokens,
          webSearchCalls: usage.webSearchCalls,
          costMicros: Number(usage.costMicros),
          priced: usage.priced,
        }
      : null,
  };
}
