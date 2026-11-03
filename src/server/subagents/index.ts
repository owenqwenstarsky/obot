import "server-only";
import { db } from "@/server/db";
import { SubagentService, type SubagentStore, type TaskRow } from "@/server/agent/subagents";
import { runs } from "@/server/agent/runtime";
import { toolRegistry } from "@/server/agent/tools";
import { getAgentFlags, getSettings } from "@/server/settings";
import { getSelectableModel } from "@/server/llm/models";
import { toCatalogModel } from "@/server/llm/catalog";
import { checkCanRun } from "@/server/billing/usage";
import type { Prisma } from "@/generated/prisma/client";

const json = (v: unknown) => v as Prisma.InputJsonValue;

export const SUBAGENT_SUFFIX = `## Your role: sub-agent
You are a sub-agent working for an orchestrating agent, not talking to the user directly. Your brief (the first user message) is your only context. Work autonomously; don't ask questions, make reasonable assumptions and state them. Your FINAL message is returned verbatim to the orchestrator, so make it self-contained: the answer or deliverable first, then key evidence, sources, file paths in the shared sandbox, and any caveats. Be concise.`;

const store: SubagentStore = {
  async allowedModels() {
    const rows = await db.subagentModel.findMany({
      where: { model: { enabled: true, available: true } },
      include: { model: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((r) => {
      const m = toCatalogModel(r.model, true);
      return {
        id: m.id,
        displayName: m.displayName,
        description: r.description ?? m.description,
        efforts: m.efforts as string[],
        defaultEffort: r.defaultEffort && (m.efforts as string[]).includes(r.defaultEffort) ? r.defaultEffort : m.defaultEffort,
        supportsWebSearch: m.supportsWebSearch,
      };
    });
  },
  async createTask(a) {
    return db.$transaction(async (tx) => {
      const thread = await tx.thread.create({
        data: {
          userId: a.userId,
          kind: "SUBAGENT",
          parentThreadId: a.parentThreadId,
          title: a.title,
          titleGenerated: true,
          lastModelId: a.modelId,
          lastEffort: a.effort,
        },
      });
      await tx.message.create({
        data: {
          threadId: thread.id,
          role: "USER",
          parts: json([{ type: "user_text", id: `brief_${thread.id}`, text: a.prompt }]),
          searchText: a.prompt.slice(0, 100_000),
          status: "COMPLETE",
          createdAt: new Date(),
        },
      });
      return tx.subagentTask.create({
        data: {
          userId: a.userId,
          parentThreadId: a.parentThreadId,
          parentRunId: a.parentRunId,
          parentMessageId: a.parentMessageId,
          callId: a.callId,
          childThreadId: thread.id,
          title: a.title,
          prompt: a.prompt,
          modelId: a.modelId,
          effort: a.effort,
        },
      }) as Promise<TaskRow>;
    });
  },
  async setChildRun(taskId, runId) {
    await db.subagentTask.update({ where: { id: taskId }, data: { childRunId: runId } });
  },
  async settle(taskId, s) {
    const now = new Date();
    const res = await db.subagentTask.updateMany({
      where: { id: taskId, status: "RUNNING" },
      data: { status: s.status, result: s.result, error: s.error, endedAt: now, ...(s.notified ? { notifiedAt: now } : {}) },
    });
    if (res.count === 0) return null;
    return db.subagentTask.findUnique({ where: { id: taskId } }) as Promise<TaskRow | null>;
  },
  async markNotified(taskIds) {
    if (taskIds.length) await db.subagentTask.updateMany({ where: { id: { in: taskIds }, notifiedAt: null }, data: { notifiedAt: new Date() } });
  },
  async listForParentRun(parentRunId) {
    return db.subagentTask.findMany({ where: { parentRunId }, orderBy: { createdAt: "asc" } }) as Promise<TaskRow[]>;
  },
  async get(taskId) {
    return db.subagentTask.findUnique({ where: { id: taskId } }) as Promise<TaskRow | null>;
  },
};

const g = globalThis as unknown as { __obotSubagents?: SubagentService };

export function subagents(): SubagentService {
  if (!g.__obotSubagents) {
    g.__obotSubagents = new SubagentService({
      store,
      launch: async (task, parent, allowed) => {
        // Imported lazily to avoid an import cycle (turns → features → subagents → turns).
        const { launchAssistantRun } = await import("@/server/agent/turns");
        const model = await getSelectableModel(task.modelId);
        if (!model) throw new Error(`${task.modelId} is no longer available.`);
        const thread = await db.thread.findUniqueOrThrow({ where: { id: task.childThreadId } });
        const brief = await db.message.findFirstOrThrow({ where: { threadId: thread.id, role: "USER" }, orderBy: { createdAt: "asc" } });
        const turn = await launchAssistantRun({
          userId: task.userId,
          thread,
          model,
          effort: task.effort,
          webSearch: parent.webSearch && allowed.supportsWebSearch,
          parent: brief,
          kind: "SUBAGENT",
          parentRunId: parent.runId,
          rootThreadId: parent.rootThreadId,
          systemPromptSuffix: SUBAGENT_SUFFIX,
        });
        return { runId: turn.runId };
      },
      stopRun: (runId) => runs().stop(runId),
      publish: (parentRunId, event) => runs().publish(parentRunId, event),
      canRun: async (userId, modelId) => {
        const model = await getSelectableModel(modelId);
        if (!model) return { allowed: false, message: `${modelId} isn't available.` };
        const gate = await checkCanRun(userId, model.hasPrice);
        return gate.allowed ? { allowed: true } : { allowed: false, message: gate.message };
      },
      maxConcurrent: async () => Math.max(1, Math.min(8, (await getSettings()).subagentMaxConcurrent)),
      childToolNames: async () => {
        const flags = await getAgentFlags();
        return toolRegistry.select({ threadKind: "SUBAGENT", model: { supportsFunctionTools: true }, flags }).names();
      },
      log: (msg, err) => console.error(msg, err),
    });
  }
  return g.__obotSubagents;
}
