import "server-only";
import { db } from "@/server/db";
import { badRequest, HttpError, notFound } from "@/server/auth/errors";
import type { CurrentUser } from "@/server/auth/session";
import { hashToken, newInviteToken } from "@/server/auth/tokens";
import { env } from "@/config/env";
import { getSettings } from "@/server/settings";
import { getOwnedThread } from "@/server/agent/turns";
import { getAllCatalogModels } from "@/server/llm/models";
import { activePath } from "@/lib/branches";
import type { MessagePart } from "@/lib/parts";
import { buildShareSnapshot, isShareSnapshot, snapshotAttachmentIds, type ShareSnapshot } from "@/lib/share";

export type ClientShare = { id: string; createdAt: string; messageCount: number };

/** The conversation the owner currently sees (root → current leaf). */
export async function loadVisiblePath(threadId: string, leafId: string | null) {
  const messages = await db.message.findMany({ where: { threadId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return activePath(messages, leafId).map((m) => ({
    id: m.id,
    role: m.role,
    parts: (Array.isArray(m.parts) ? m.parts : []) as unknown as MessagePart[],
    modelId: m.modelId,
    status: m.status,
    createdAt: m.createdAt,
  }));
}

async function assertSharingEnabled() {
  const settings = await getSettings();
  if (!settings.sharingEnabled) throw new HttpError(403, "Sharing is turned off on this instance.", "SHARING_DISABLED");
}

export async function createShare(user: CurrentUser, threadId: string) {
  await assertSharingEnabled();
  const thread = await getOwnedThread(user, threadId);
  if (thread.kind === "SUBAGENT") throw badRequest("Share the parent thread instead.");
  const path = await loadVisiblePath(thread.id, thread.currentLeafId);
  if (path.length === 0) throw badRequest("There's nothing to share yet.");
  const names = new Map((await getAllCatalogModels().catch(() => [])).map((m) => [m.id, m.displayName]));
  const snapshot = buildShareSnapshot(thread.title, path, { modelName: (id) => names.get(id) ?? null });
  const { token, hash } = newInviteToken();
  const share = await db.threadShare.create({
    data: { threadId: thread.id, userId: user.id, tokenHash: hash, snapshot: snapshot as never },
  });
  return {
    share: { id: share.id, createdAt: share.createdAt.toISOString(), messageCount: snapshot.messages.length } satisfies ClientShare,
    url: `${env().APP_URL.replace(/\/$/, "")}/share/${token}`,
  };
}

export async function listShares(user: CurrentUser, threadId: string): Promise<ClientShare[]> {
  await getOwnedThread(user, threadId);
  const shares = await db.threadShare.findMany({
    where: { threadId, userId: user.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return shares.map((s) => ({
    id: s.id,
    createdAt: s.createdAt.toISOString(),
    messageCount: isShareSnapshot(s.snapshot) ? s.snapshot.messages.length : 0,
  }));
}

export async function revokeShare(user: CurrentUser, threadId: string, shareId: string) {
  await getOwnedThread(user, threadId);
  const share = await db.threadShare.findFirst({ where: { id: shareId, threadId, userId: user.id } });
  if (!share) throw notFound("Share link");
  if (!share.revokedAt) await db.threadShare.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
}

/**
 * Resolve a public share token. Null when the link is unknown, revoked, sharing is off, the
 * thread was deleted, or the owner's account is disabled.
 */
export async function lookupShare(token: string): Promise<{ id: string; userId: string; snapshot: ShareSnapshot } | null> {
  if (!/^[\w-]{20,100}$/.test(token)) return null;
  const share = await db.threadShare.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { thread: { select: { deletedAt: true } }, user: { select: { status: true } } },
  });
  if (!share || share.revokedAt || share.thread.deletedAt || share.user.status !== "ACTIVE") return null;
  if (!(await getSettings()).sharingEnabled) return null;
  if (!isShareSnapshot(share.snapshot)) return null;
  return { id: share.id, userId: share.userId, snapshot: share.snapshot };
}

/** An attachment visible through a share: it must be referenced by the snapshot and owned by the sharer. */
export async function sharedAttachment(token: string, attachmentId: string) {
  const share = await lookupShare(token);
  if (!share || !snapshotAttachmentIds(share.snapshot).has(attachmentId)) return null;
  return db.attachment.findFirst({ where: { id: attachmentId, userId: share.userId } });
}
