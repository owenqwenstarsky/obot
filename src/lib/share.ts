/**
 * Share snapshots and exports (pure). A share freezes the conversation the owner sees at
 * share time; later messages and other branches never leak.
 */
import type { MessagePart } from "@/lib/parts";

export type ShareMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  parts: MessagePart[];
  modelId: string | null;
  /** Display name at share time (viewers can't look models up). */
  modelName: string | null;
  status: "STREAMING" | "COMPLETE" | "STOPPED" | "ERROR";
  createdAt: string;
};

export type ShareSnapshot = {
  v: 1;
  title: string;
  sharedAt: string;
  messages: ShareMessage[];
};

type SourceMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  parts: MessagePart[];
  modelId: string | null;
  status: ShareMessage["status"];
  createdAt: string | Date;
};

/** Strip what viewers shouldn't get: reasoning summaries, live tool logs, and the model transcript (never included). */
function shareablePart(p: MessagePart): MessagePart | null {
  if (p.type === "reasoning" || p.type === "waiting") return null;
  if (p.type === "tool" && p.tool === "function") {
    const { log: _log, ...rest } = p;
    void _log;
    return rest;
  }
  if (p.type === "tool" && p.tool === "generic") return { ...p, raw: null };
  return p;
}

export function buildShareSnapshot(
  title: string,
  path: SourceMessage[],
  opts: { now?: Date; modelName?: (id: string) => string | null } = {},
): ShareSnapshot {
  const now = opts.now ?? new Date();
  return {
    v: 1,
    title,
    sharedAt: now.toISOString(),
    messages: path.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts.map(shareablePart).filter((p): p is MessagePart => p != null),
      modelId: m.modelId,
      modelName: m.modelId ? (opts.modelName?.(m.modelId) ?? null) : null,
      // A reply still being written is shared as-is and marked stopped.
      status: m.status === "STREAMING" ? "STOPPED" : m.status,
      createdAt: typeof m.createdAt === "string" ? m.createdAt : m.createdAt.toISOString(),
    })),
  };
}

/** Attachment ids a snapshot references (only these may be served through the share link). */
export function snapshotAttachmentIds(s: ShareSnapshot): Set<string> {
  const ids = new Set<string>();
  for (const m of s.messages) {
    for (const p of m.parts) {
      if (p.type === "user_image" || p.type === "user_file") ids.add(p.attachmentId);
    }
  }
  return ids;
}

export function isShareSnapshot(v: unknown): v is ShareSnapshot {
  return !!v && typeof v === "object" && (v as ShareSnapshot).v === 1 && Array.isArray((v as ShareSnapshot).messages);
}
