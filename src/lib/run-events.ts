/** Events streamed from a live agent run to clients (SSE). Shared client/server types. */
import type { PartOp } from "./part-ops";
import type { MessagePart, SubagentTaskStatusValue, UsageSnapshot } from "./parts";

export type RunStatusValue = "RUNNING" | "COMPLETED" | "STOPPED" | "FAILED" | "INTERRUPTED";
export type MessageStatusValue = "STREAMING" | "COMPLETE" | "STOPPED" | "ERROR";

/** What the run is doing right now. */
export type RunPhase = "model" | "tools" | "waiting";

/** A steering message queued for injection at the next step boundary. */
export type PendingSteer = { id: string; text: string; at: number };

/** Sub-agent task summary as seen by clients. */
export type ClientTask = {
  id: string;
  title: string;
  childThreadId: string;
  modelId: string;
  status: SubagentTaskStatusValue;
  error: string | null;
  createdAt: string;
  endedAt: string | null;
};

export type RunEvent =
  | { seq: number; type: "ops"; ops: PartOp[] }
  | { seq: number; type: "title"; threadId: string; title: string }
  | { seq: number; type: "phase"; phase: RunPhase; step: number }
  | { seq: number; type: "steer_queue"; pending: PendingSteer[] }
  | { seq: number; type: "task"; task: ClientTask }
  | {
      seq: number;
      type: "done";
      runStatus: RunStatusValue;
      messageStatus: MessageStatusValue;
      parts: MessagePart[];
      error: string | null;
      /** Sum across all model calls in the run. */
      usage: UsageSnapshot | null;
      /** Usage of the last model call (context window indicator). */
      contextUsage: UsageSnapshot | null;
      costMicros: number;
      webSearchCalls: number;
      steps: number;
    };

type WithoutSeq<T> = T extends unknown ? Omit<T, "seq"> : never;
export type RunEventInput = WithoutSeq<RunEvent>;
