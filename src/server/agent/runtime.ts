import "server-only";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { llm } from "@/server/llm/client";
import { RunManager } from "@/server/agent/run-manager";
import { recordUsage } from "@/server/billing/usage";
import type { StreamEvent } from "@/server/llm/stream-normalizer";
import { emptyUsage, type ContextSnapshot } from "@/lib/parts";

function createManager() {
  return new RunManager({
    openStream: async (body, signal) => {
      const stream = await llm().responses.create(body as ResponseCreateParamsStreaming, { signal });
      return stream as unknown as AsyncIterable<StreamEvent>;
    },
    saveParts: async (messageId, parts) => {
      await db.message.updateMany({
        where: { id: messageId, status: "STREAMING" },
        data: { parts: parts as unknown as Prisma.InputJsonValue },
      });
    },
    finish: async (r) => {
      await db.message.updateMany({
        where: { id: r.messageId },
        data: {
          parts: r.parts as unknown as Prisma.InputJsonValue,
          rawOutput: r.rawOutput as unknown as Prisma.InputJsonValue,
          status: r.messageStatus,
          error: r.error,
          responseId: r.responseId,
        },
      });
      await db.run.update({
        where: { id: r.runId },
        data: { status: r.runStatus, error: r.error, endedAt: new Date() },
      });
      if (r.usage) {
        const ctx: ContextSnapshot = { ...r.usage, modelId: r.modelId, at: new Date().toISOString() };
        await db.thread.update({
          where: { id: r.threadId },
          data: { lastContext: ctx as unknown as Prisma.InputJsonValue },
        });
      }
      const record = await recordUsage({
        userId: r.userId,
        threadId: r.threadId,
        messageId: r.messageId,
        runId: r.runId,
        kind: "CHAT",
        modelId: r.modelId,
        effort: r.effort,
        usage: r.usage ?? emptyUsage(),
        webSearchCalls: r.webSearchCalls,
        responseId: r.responseId,
        note: r.usage ? null : `no usage reported (run ${r.runStatus.toLowerCase()})`,
      });
      return { costMicros: Number(record.costMicros) };
    },
    log: (msg, err) => console.error(msg, err),
  });
}

const g = globalThis as unknown as { __obotRuns?: RunManager };

export function runs(): RunManager {
  if (!g.__obotRuns) g.__obotRuns = createManager();
  return g.__obotRuns;
}

/** Called once at server boot: any run left RUNNING by a previous process is dead. */
export async function recoverInterruptedRuns() {
  const stale = await db.run.findMany({ where: { status: "RUNNING" }, select: { id: true, assistantMessageId: true } });
  if (stale.length === 0) return 0;
  await db.run.updateMany({
    where: { id: { in: stale.map((r) => r.id) } },
    data: { status: "INTERRUPTED", endedAt: new Date(), error: "Server restarted during this run." },
  });
  const messageIds = stale.map((r) => r.assistantMessageId).filter((id): id is string => !!id);
  if (messageIds.length) {
    await db.message.updateMany({
      where: { id: { in: messageIds }, status: "STREAMING" },
      data: { status: "STOPPED", error: "Interrupted by a server restart." },
    });
  }
  return stale.length;
}
