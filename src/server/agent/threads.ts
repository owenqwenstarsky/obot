import "server-only";
import { db } from "@/server/db";
import type { CurrentUser } from "@/server/auth/session";
import { getOwnedThread } from "@/server/agent/turns";
import { runs } from "@/server/agent/runtime";
import { HttpError } from "@/server/auth/errors";
import {
  serializeMessage,
  serializeTask,
  serializeThread,
  type ClientThreadDetail,
  type ThreadChild,
  type ThreadListEntry,
} from "@/server/agent/serialize";

export async function listThreads(user: CurrentUser, query?: string | null): Promise<ThreadListEntry[]> {
  const q = query?.trim();
  const threads = await db.thread.findMany({
    where: {
      userId: user.id,
      deletedAt: null,
      parentThreadId: null,
      ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ pinned: "desc" }, { lastMessageAt: "desc" }],
    take: 500,
  });
  const ids = threads.map((t) => t.id);
  const children = ids.length
    ? await db.thread.findMany({
        where: { parentThreadId: { in: ids }, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, title: true, parentThreadId: true, task: { select: { status: true } } },
      })
    : [];
  const allIds = [...ids, ...children.map((c) => c.id)];
  const active = await db.run.findMany({
    where: { userId: user.id, status: "RUNNING", threadId: { in: allIds } },
    select: { threadId: true, id: true },
  });
  const liveThreads = new Set(active.filter((r) => runs().isLive(r.id)).map((r) => r.threadId));
  const byParent = new Map<string, ThreadChild[]>();
  for (const c of children) {
    const list = byParent.get(c.parentThreadId!) ?? [];
    list.push({ id: c.id, title: c.title, running: liveThreads.has(c.id), taskStatus: c.task?.status ?? null });
    byParent.set(c.parentThreadId!, list);
  }
  return threads.map((t) => ({
    ...serializeThread(t),
    running: liveThreads.has(t.id),
    children: byParent.get(t.id) ?? [],
  }));
}

export async function getThreadDetail(user: CurrentUser, threadId: string): Promise<ClientThreadDetail> {
  const thread = await getOwnedThread(user, threadId);
  const usageWhere = { threadId, kind: { in: ["CHAT" as const, "SUBAGENT" as const] }, messageId: { not: null } };
  const [messages, usage, unpriced, spent, activeRun, parent, task, tasks] = await Promise.all([
    db.message.findMany({ where: { threadId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.usageRecord.groupBy({
      by: ["messageId"],
      where: usageWhere,
      _sum: {
        inputTokens: true,
        cachedInputTokens: true,
        outputTokens: true,
        reasoningTokens: true,
        totalTokens: true,
        webSearchCalls: true,
        costMicros: true,
      },
    }),
    db.usageRecord.groupBy({ by: ["messageId"], where: { ...usageWhere, priced: false }, _count: { _all: true } }),
    // A parent thread's spend includes its sub-agents (recorded with rootThreadId).
    db.usageRecord.aggregate({
      where: thread.parentThreadId ? { threadId } : { OR: [{ threadId }, { rootThreadId: threadId }] },
      _sum: { costMicros: true },
    }),
    db.run.findFirst({ where: { threadId, status: "RUNNING" }, orderBy: { startedAt: "desc" } }),
    thread.parentThreadId
      ? db.thread.findFirst({ where: { id: thread.parentThreadId }, select: { id: true, title: true } })
      : Promise.resolve(null),
    thread.kind === "SUBAGENT" ? db.subagentTask.findUnique({ where: { childThreadId: threadId } }) : Promise.resolve(null),
    db.subagentTask.findMany({ where: { parentThreadId: threadId }, orderBy: { createdAt: "asc" } }),
  ]);
  const unpricedMessages = new Set(unpriced.map((u) => u.messageId));
  const usageByMessage = new Map(
    usage.map((u) => {
      const sum = u._sum;
      return [
        u.messageId,
        {
          messageId: u.messageId,
          inputTokens: sum.inputTokens ?? 0,
          cachedInputTokens: sum.cachedInputTokens ?? 0,
          outputTokens: sum.outputTokens ?? 0,
          reasoningTokens: sum.reasoningTokens ?? 0,
          totalTokens: sum.totalTokens ?? 0,
          webSearchCalls: sum.webSearchCalls ?? 0,
          costMicros: sum.costMicros ?? 0n,
          priced: !unpricedMessages.has(u.messageId),
        },
      ];
    }),
  );
  const live = activeRun && runs().get(activeRun.id) ? activeRun : null;
  return {
    ...serializeThread(thread),
    spentMicros: Number(spent._sum.costMicros ?? 0n),
    messages: messages.map((m) => serializeMessage(m, usageByMessage.get(m.id))),
    activeRun: live ? { id: live.id, messageId: live.assistantMessageId } : null,
    parent: parent ?? null,
    task: task ? serializeTask(task) : null,
    tasks: tasks.map(serializeTask),
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

type DeleteHook = (threadId: string) => Promise<void>;
const gd = globalThis as unknown as { __obotThreadDeleteHooks?: Map<string, DeleteHook> };
const deleteHooks: Map<string, DeleteHook> = (gd.__obotThreadDeleteHooks ??= new Map());

/** Features register cleanup for deleted top-level threads (e.g. sandbox snapshots). */
export function registerThreadDeleteHook(name: string, hook: DeleteHook) {
  deleteHooks.set(name, hook);
}

/** Soft delete; stops any live run first (which cancels its sub-agents). Usage records are untouched. */
export async function deleteThread(user: CurrentUser, threadId: string) {
  const thread = await getOwnedThread(user, threadId);
  if (thread.kind === "SUBAGENT") {
    throw new HttpError(400, "Sub-agent threads belong to their parent. Delete or regenerate the parent message instead.");
  }
  const active = await db.run.findMany({ where: { threadId, status: "RUNNING" }, select: { id: true } });
  for (const r of active) runs().stop(r.id);
  const now = new Date();
  await db.thread.update({ where: { id: threadId }, data: { deletedAt: now, pinned: false } });
  await db.thread.updateMany({ where: { parentThreadId: threadId, deletedAt: null }, data: { deletedAt: now } });
  for (const [name, hook] of deleteHooks) {
    await hook(threadId).catch((err: unknown) => console.error(`[threads] delete hook ${name} failed`, err));
  }
}
