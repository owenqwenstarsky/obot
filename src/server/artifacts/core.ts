/**
 * Artifact logic independent of the database (store injected) so it can be unit-tested.
 */
import type { ArtifactKindValue } from "@/lib/parts";
import type { ArtifactApi, ArtifactRef } from "@/server/agent/tools/types";

export const MAX_ARTIFACT_CHARS = 500_000;

export type DbArtifactKind = "MARKDOWN" | "HTML" | "REACT";
export type DbArtifactStatus = "GENERATING" | "READY" | "FAILED";

export type ArtifactRow = {
  id: string;
  userId: string;
  threadId: string;
  title: string;
  kind: DbArtifactKind;
  status: DbArtifactStatus;
  currentVersion: number;
  deletedAt: Date | null;
};

export interface ArtifactStore {
  get(id: string): Promise<ArtifactRow | null>;
  createWithVersion(a: {
    userId: string;
    threadId: string;
    runId: string;
    messageId: string;
    title: string;
    kind: DbArtifactKind;
    content: string;
  }): Promise<ArtifactRow>;
  /** Adds version `expectedVersion + 1` and marks the artifact READY. Fails if another writer won. */
  addVersion(a: {
    artifactId: string;
    expectedVersion: number;
    messageId: string;
    title: string;
    kind?: DbArtifactKind;
    content: string;
  }): Promise<ArtifactRow>;
  markFailed(id: string, error: string): Promise<void>;
}

export const toDbKind = (k: ArtifactKindValue): DbArtifactKind =>
  k === "html" ? "HTML" : k === "react" ? "REACT" : "MARKDOWN";
export const fromDbKind = (k: DbArtifactKind): ArtifactKindValue =>
  k === "HTML" ? "html" : k === "REACT" ? "react" : "markdown";

const ref = (r: ArtifactRow): ArtifactRef => ({ artifactId: r.id, version: r.currentVersion, title: r.title, kind: fromDbKind(r.kind) });

function checkContent(content: string) {
  if (!content.trim()) throw new Error("Artifact content can't be empty.");
  if (content.length > MAX_ARTIFACT_CHARS) {
    throw new Error(`Artifact content is too large (${content.length} characters; max ${MAX_ARTIFACT_CHARS}).`);
  }
}

export function cleanTitle(title: string) {
  return title.trim().replace(/\s+/g, " ").slice(0, 120) || "Untitled artifact";
}

export function createArtifactApi(
  store: ArtifactStore,
  ctx: { userId: string; threadId: string; runId: string; messageId: string; pendingArtifactId?: string | null },
): ArtifactApi {
  let pending = ctx.pendingArtifactId ?? null;
  return {
    async create({ title, kind, content }) {
      checkContent(content);
      if (pending) {
        const placeholder = await store.get(pending);
        pending = null;
        if (placeholder && placeholder.userId === ctx.userId && placeholder.status === "GENERATING" && placeholder.currentVersion === 0) {
          return ref(
            await store.addVersion({
              artifactId: placeholder.id,
              expectedVersion: 0,
              messageId: ctx.messageId,
              title: cleanTitle(title),
              kind: toDbKind(kind),
              content,
            }),
          );
        }
      }
      return ref(
        await store.createWithVersion({
          userId: ctx.userId,
          threadId: ctx.threadId,
          runId: ctx.runId,
          messageId: ctx.messageId,
          title: cleanTitle(title),
          kind: toDbKind(kind),
          content,
        }),
      );
    },
    async update({ artifactId, content, title }) {
      checkContent(content);
      const row = await store.get(artifactId);
      if (!row || row.userId !== ctx.userId || row.deletedAt) throw new Error(`Artifact ${artifactId} not found.`);
      if (row.status === "GENERATING" && row.currentVersion === 0) throw new Error("That artifact is still being generated.");
      return ref(
        await store.addVersion({
          artifactId: row.id,
          expectedVersion: row.currentVersion,
          messageId: ctx.messageId,
          title: title ? cleanTitle(title) : row.title,
          content,
        }),
      );
    },
  };
}

/** After a background-generation run settles: fail the placeholder if it was never filled. */
export async function finalizePendingArtifact(
  store: ArtifactStore,
  args: { pendingArtifactId: string; runStatus: string; error: string | null },
) {
  const row = await store.get(args.pendingArtifactId);
  if (!row || row.status !== "GENERATING") return;
  const reason =
    args.runStatus === "STOPPED"
      ? "Generation was stopped."
      : args.error ?? "The agent finished without creating the artifact.";
  await store.markFailed(row.id, reason);
}
