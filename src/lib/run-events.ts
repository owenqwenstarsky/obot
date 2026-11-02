/** Events streamed from a live agent run to clients (SSE). Shared client/server types. */
import type { PartOp } from "./part-ops";
import type { MessagePart, UsageSnapshot } from "./parts";

export type RunStatusValue = "RUNNING" | "COMPLETED" | "STOPPED" | "FAILED" | "INTERRUPTED";
export type MessageStatusValue = "STREAMING" | "COMPLETE" | "STOPPED" | "ERROR";

export type RunEvent =
  | { seq: number; type: "ops"; ops: PartOp[] }
  | { seq: number; type: "title"; threadId: string; title: string }
  | {
      seq: number;
      type: "done";
      runStatus: RunStatusValue;
      messageStatus: MessageStatusValue;
      parts: MessagePart[];
      error: string | null;
      usage: UsageSnapshot | null;
      costMicros: number;
      webSearchCalls: number;
    };

export type RunEventInput =
  | { type: "ops"; ops: PartOp[] }
  | { type: "title"; threadId: string; title: string }
  | Omit<Extract<RunEvent, { type: "done" }>, "seq">;
