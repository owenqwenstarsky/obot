import "server-only";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { llm } from "@/server/llm/client";
import { RunManager, type RunFinish, type RunHandle, type StartRunParams } from "@/server/agent/run-manager";
import type { ToolServices } from "@/server/agent/tools/types";
import { checkCanRun, recordUsage } from "@/server/billing/usage";
import type { StreamEvent } from "@/server/llm/stream-normalizer";
import { emptyUsage, partsToSearchText, type ContextSnapshot, type MessagePart } from "@/lib/parts";

const json = (v: unknown) => v as unknown as Prisma.InputJsonValue;

type ServiceFactory = (p: StartRunParams, h: RunHandle) => Partial<Omit<ToolServices, "steering">>;
type SettledHook = (r: RunFinish) => void | Promise<void>;
type DeleteHook = (threadId: string) => Promise<void>;

/**
 * Feature modules register per-run services and run-settled hooks here at import time,
 * keeping this module free of feature dependencies.
 */
const g = globalThis as unknown as {
  __obotRuns?: RunManager;
  __obotServiceFactories?: Map<string, ServiceFactory>;
  __obotSettledHooks?: Map<string, SettledHook>;
  __obotThreadDeleteHooks?: Map<string, DeleteHook>;
  __obotWatcherFactory?: (p: StartRunParams) => ReturnType<NonNullable<ConstructorParameters<typeof RunManager>[0]["watcher"]>>;
};
const serviceFactories = (g.__obotServiceFactories ??= new Map());
const settledHooks = (g.__obotSettledHooks ??= new Map());
const deleteHooks: Map<string, DeleteHook> = (g.__obotThreadDeleteHooks ??= new Map());

/** Features register cleanup for deleted top-level threads (e.g. sandbox snapshots). */
export function registerThreadDeleteHook(name: string, hook: DeleteHook) {
  deleteHooks.set(name, hook);
}
export function threadDeleteHooks(): Iterable<[string, DeleteHook]> {
  return deleteHooks.entries();
}

export function registerServiceFactory(name: string, f: ServiceFactory) {
  serviceFactories.set(name, f);
}
export function registerSettledHook(name: string, h: SettledHook) {
  settledHooks.set(name, h);
}
export function registerWatcherFactory(f: NonNullable<typeof g.__obotWatcherFactory>) {
  g.__obotWatcherFactory = f;
}

function createManager() {
  return new RunManager({
    openStream: async (body, signal) => {
      const stream = await llm().responses.create(body as ResponseCreateParamsStreaming, { signal });
      return stream as unknown as AsyncIterable<StreamEvent>;
    },
    saveProgress: async (messageId, parts, transcript) => {
      await db.message.updateMany({
        where: { id: messageId, status: "STREAMING" },
        data: {
          parts: json(parts),
          searchText: partsToSearchText(parts as MessagePart[]),
          ...(transcript ? { rawOutput: json(transcript) } : {}),
        },
      });
    },
    recordStep: async (s) => {
      const record = await recordUsage({
        userId: s.userId,
        threadId: s.threadId,
        rootThreadId: s.rootThreadId,
        messageId: s.messageId,
        runId: s.runId,
        kind: s.usageKind,
        modelId: s.modelId,
        effort: s.effort,
        usage: s.usage ?? emptyUsage(),
        webSearchCalls: s.webSearchCalls,
        responseId: s.responseId,
        stepIndex: s.stepIndex,
        note: s.usage ? null : `no usage reported (step ${s.outcome})`,
      });
      return { costMicros: Number(record.costMicros) };
    },
    canContinue: async (p) => {
      const gate = await checkCanRun(p.userId, p.modelHasPrice ?? true);
      return gate.allowed ? { allowed: true } : { allowed: false, message: gate.message };
    },
    finish: async (r) => {
      await db.message.updateMany({
        where: { id: r.messageId },
        data: {
          parts: json(r.parts),
          searchText: partsToSearchText(r.parts as MessagePart[]),
          rawOutput: json(r.rawOutput),
          status: r.messageStatus,
          error: r.error,
          responseId: r.responseId,
        },
      });
      await db.run.update({
        where: { id: r.runId },
        data: { status: r.runStatus, error: r.error, endedAt: new Date(), steps: r.steps },
      });
      // Side-by-side comparison replies don't own the thread's context meter.
      if (r.contextUsage && r.meta.compareSecondary !== true) {
        const ctx: ContextSnapshot = { ...r.contextUsage, modelId: r.modelId, at: new Date().toISOString() };
        await db.thread.update({ where: { id: r.threadId }, data: { lastContext: json(ctx) } });
      }
    },
    services: (p, h) => {
      let out: Partial<Omit<ToolServices, "steering">> = {};
      for (const f of serviceFactories.values()) out = { ...out, ...f(p, h) };
      return out;
    },
    watcher: (p) => g.__obotWatcherFactory?.(p) ?? null,
    onSettled: (r) => {
      for (const [name, h] of settledHooks) {
        Promise.resolve()
          .then(() => h(r))
          .catch((err) => console.error(`[runs] settled hook ${name} failed`, err));
      }
    },
    log: (msg, err) => console.error(msg, err),
  });
}

export function runs(): RunManager {
  if (!g.__obotRuns) g.__obotRuns = createManager();
  return g.__obotRuns;
}

/** Called once at server boot: any run left RUNNING by a previous process is dead. */
export async function recoverInterruptedRuns() {
  const stale = await db.run.findMany({ where: { status: "RUNNING" }, select: { id: true, assistantMessageId: true } });
  await db.subagentTask.updateMany({
    where: { status: "RUNNING" },
    data: { status: "INTERRUPTED", endedAt: new Date(), error: "Server restarted while this task was running." },
  });
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
