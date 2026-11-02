import "server-only";
import { db } from "@/server/db";
import type { CurrentUser } from "@/server/auth/session";
import { getOwnedThread } from "@/server/agent/turns";
import { runs } from "@/server/agent/runtime";
import { serializeMessage, serializeThread, type ClientThreadDetail } from "@/server/agent/serialize";

export async function listThreads(user: CurrentUser, query?: string | null) {
  const q = query?.trim();
  const threads = await db.thread.findMany({
    where: {
      userId: user.id,
      deletedAt: null,
      ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ pinned: "desc" }, { lastMessageAt: "desc" }],
    take: 500,
  });
  const active = await db.run.findMany({
    where: { userId: user.id, status: "RUNNING", threadId: { in: threads.map((t) => t.id) } },
    select: { threadId: true, id: true },
  });
  const liveThreads = new Set(active.filter((r) => runs().isLive(r.id)).map((r) => r.threadId));
  return threads.map((t) => ({ ...serializeThread(t), running: liveThreads.has(t.id) }));
}

export async function getThreadDetail(user: CurrentUser, threadId: string): Promise<ClientThreadDetail> {
  const thread = await getOwnedThread(user, threadId);
  const [messages, usage, spent, activeRun] = await Promise.all([
    db.message.findMany({ where: { threadId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.usageRecord.findMany({
      where: { threadId, kind: "CHAT", messageId: { not: null } },
      select: {
        messageId: true,
        inputTokens: true,
        cachedInputTokens: true,
        outputTokens: true,
        reasoningTokens: true,
        totalTokens: true,
        webSearchCalls: true,
        costMicros: true,
        priced: true,
      },
    }),
    db.usageRecord.aggregate({ where: { threadId }, _sum: { costMicros: true } }),
    db.run.findFirst({ where: { threadId, status: "RUNNING" }, orderBy: { startedAt: "desc" } }),
  ]);
  const usageByMessage = new Map(usage.map((u) => [u.messageId, u]));
  const live = activeRun && runs().get(activeRun.id) ? activeRun : null;
  return {
    ...serializeThread(thread),
    spentMicros: Number(spent._sum.costMicros ?? 0n),
    messages: messages.map((m) => serializeMessage(m, usageByMessage.get(m.id))),
    activeRun: live ? { id: live.id, messageId: live.assistantMessageId } : null,
  };
}

export async function updateThread(
  user: CurrentUser,
  threadId: string,
  patch: { title?: string; pinned?: boolean; webSearchEnabled?: boolean },
) {
  await getOwnedThread(user, threadId);
  const thread = await db.thread.update({
    where: { id: threadId },
    data: {
      ...(patch.title != null ? { title: patch.title.trim().slice(0, 120) || "Untitled", titleGenerated: true } : {}),
      ...(patch.pinned != null ? { pinned: patch.pinned } : {}),
      ...(patch.webSearchEnabled != null ? { webSearchEnabled: patch.webSearchEnabled } : {}),
    },
  });
  return serializeThread(thread);
}

/** Soft delete; stops any live run first. Usage records are untouched. */
export async function deleteThread(user: CurrentUser, threadId: string) {
  await getOwnedThread(user, threadId);
  const active = await db.run.findMany({ where: { threadId, status: "RUNNING" }, select: { id: true } });
  for (const r of active) runs().stop(r.id);
  await db.thread.update({ where: { id: threadId }, data: { deletedAt: new Date(), pinned: false } });
}
