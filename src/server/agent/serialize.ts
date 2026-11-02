import type { Message, SubagentTask, Thread } from "@/generated/prisma/client";
import type { ContextSnapshot, MessagePart } from "@/lib/parts";
import type { ClientTask } from "@/lib/run-events";

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
  kind: "CHAT" | "SUBAGENT";
  parentThreadId: string | null;
};

export type ThreadChild = {
  id: string;
  title: string;
  running: boolean;
  taskStatus: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "INTERRUPTED" | null;
};
export type ThreadListEntry = ClientThread & { running: boolean; children: ThreadChild[] };

export type ClientThreadDetail = ClientThread & {
  spentMicros: number;
  messages: ClientMessage[];
  activeRun: { id: string; messageId: string | null } | null;
  /** For sub-agent threads: the parent thread. */
  parent: { id: string; title: string } | null;
  /** For sub-agent threads: this thread's task. */
  task: ClientTask | null;
  /** Tasks spawned from this thread. */
  tasks: ClientTask[];
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
    kind: t.kind,
    parentThreadId: t.parentThreadId,
  };
}

export function serializeTask(t: SubagentTask): ClientTask {
  return {
    id: t.id,
    title: t.title,
    childThreadId: t.childThreadId,
    modelId: t.modelId,
    status: t.status,
    error: t.error,
    createdAt: t.createdAt.toISOString(),
    endedAt: t.endedAt?.toISOString() ?? null,
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
