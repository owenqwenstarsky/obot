import "server-only";
import { randomUUID } from "node:crypto";
import type { Message, Prisma, Thread } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { HttpError, badRequest, notFound } from "@/server/auth/errors";
import type { CurrentUser } from "@/server/auth/session";
import { getSelectableModel } from "@/server/llm/models";
import type { CatalogModel } from "@/server/llm/catalog";
import { buildResponsesRequest, type HistoryMessage } from "@/server/llm/request-builder";
import { checkCanRun } from "@/server/billing/usage";
import { getAgentFlags, getSettings, webSearchContextSize } from "@/server/settings";
import { attachmentDataUrl } from "@/server/uploads/storage";
import { MAX_IMAGES_PER_MESSAGE } from "@/server/uploads/image-type";
import { runs } from "@/server/agent/runtime";
import { applyTitle, generateTitle } from "@/server/agent/titles";
import { serializeMessage, serializeThread } from "@/server/agent/serialize";
import { resolveEffort } from "@/lib/efforts";
import type { MessagePart } from "@/lib/parts";
import { toolRegistry } from "@/server/agent/tools";
import { buildInstructions } from "@/server/agent/system-prompt";
import type { ThreadKindValue } from "@/server/agent/tools/types";
import "@/server/agent/features";

export type TurnOptions = {
  modelId: string;
  effort?: string | null;
  webSearch: boolean;
};

const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function getOwnedThread(user: CurrentUser, threadId: string): Promise<Thread> {
  const thread = await db.thread.findFirst({ where: { id: threadId, userId: user.id, deletedAt: null } });
  if (!thread) throw notFound("Thread");
  return thread;
}

function assertChatThread(thread: Thread) {
  if (thread.kind === "SUBAGENT") {
    throw badRequest("Sub-agent threads are driven by their parent agent and can't be messaged directly.");
  }
}

async function assertNoActiveRun(threadId: string) {
  const active = await db.run.findFirst({ where: { threadId, status: "RUNNING" }, select: { id: true } });
  if (active && runs().isLive(active.id)) {
    throw new HttpError(409, "The agent is still working on this thread. Stop it first.", "RUN_ACTIVE");
  }
  if (active) {
    // Stale RUNNING row without a live process (e.g. crash): clean it up.
    await db.run.update({ where: { id: active.id }, data: { status: "INTERRUPTED", endedAt: new Date() } });
  }
}

async function resolveTurn(user: CurrentUser, opts: TurnOptions) {
  const model = await getSelectableModel(opts.modelId);
  if (!model) throw badRequest("That model isn't available. Pick another one.");
  const effort = model.supportsReasoning ? resolveEffort(opts.effort, model.efforts, model.defaultEffort ?? undefined) : null;
  const webSearch = opts.webSearch && model.supportsWebSearch;
  const gate = await checkCanRun(user.id, model.hasPrice);
  if (!gate.allowed) {
    throw new HttpError(402, gate.message, gate.code, gate.resetsAt ? { resetsAt: gate.resetsAt.toISOString() } : undefined);
  }
  return { model, effort, webSearch };
}

async function loadHistory(threadId: string, before: Date): Promise<{ history: HistoryMessage[]; images: Map<string, string> }> {
  const messages = await db.message.findMany({
    where: { threadId, createdAt: { lt: before } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const history: HistoryMessage[] = messages.map((m) => ({
    role: m.role,
    parts: (m.parts as unknown as MessagePart[]) ?? [],
    transcript: m.rawOutput,
  }));
  const attachmentIds = history.flatMap((h) =>
    h.parts.filter((p) => p.type === "user_image").map((p) => (p as { attachmentId: string }).attachmentId),
  );
  const images = new Map<string, string>();
  if (attachmentIds.length) {
    const atts = await db.attachment.findMany({ where: { id: { in: attachmentIds } } });
    await Promise.all(
      atts.map(async (a) => {
        const url = await attachmentDataUrl(a.path, a.mime);
        if (url) images.set(a.id, url);
      }),
    );
  }
  return { history, images };
}

export type LaunchRunArgs = {
  userId: string;
  thread: Thread;
  model: CatalogModel;
  effort: string | null;
  webSearch: boolean;
  /** The assistant message is created 1ms after this so ordering is stable. */
  after: Date;
  kind?: ThreadKindValue;
  parentRunId?: string | null;
  /** Top-level thread (sandbox owner). Defaults to the thread's parent or itself. */
  rootThreadId?: string;
  systemPromptSuffix?: string | null;
  /** Generate a title from this first message. */
  title?: { firstMessageText: string } | null;
  firstStepToolChoice?: { type: "function"; name: string };
  meta?: Record<string, unknown>;
};

/** Creates the assistant message + run and starts the agent loop in the background. */
export async function launchAssistantRun(args: LaunchRunArgs) {
  const { thread, model, effort, webSearch } = args;
  const kind = args.kind ?? "CHAT";
  const settings = await getSettings();
  const flags = await getAgentFlags(settings);
  const tools = toolRegistry.select({ threadKind: kind, model, flags });
  const instructions = buildInstructions({
    adminPrompt: settings.systemPrompt,
    kind,
    toolNames: tools.names(),
    flags,
    suffix: args.systemPromptSuffix,
  });
  const createdAt = new Date(Math.max(Date.now(), args.after.getTime() + 1));
  const runId = randomUUID();
  const rootThreadId = args.rootThreadId ?? thread.parentThreadId ?? thread.id;

  const assistant = await db.message.create({
    data: {
      threadId: thread.id,
      role: "ASSISTANT",
      parts: json([]),
      modelId: model.id,
      effort,
      webSearch,
      status: "STREAMING",
      createdAt,
    },
  });
  await db.run.create({
    data: {
      id: runId,
      threadId: thread.id,
      userId: args.userId,
      assistantMessageId: assistant.id,
      status: "RUNNING",
      kind,
      parentRunId: args.parentRunId ?? null,
    },
  });
  const updatedThread = await db.thread.update({
    where: { id: thread.id },
    data: { lastModelId: model.id, lastEffort: effort, webSearchEnabled: webSearch, lastMessageAt: createdAt },
  });

  const { history, images } = await loadHistory(thread.id, createdAt);
  const replayReasoning = model.replayReasoning && tools.size > 0;
  const body = buildResponsesRequest({
    model: model.id,
    effort: effort as never,
    history,
    resolveImage: (id) => images.get(id) ?? null,
    webSearch: {
      enabled: webSearch,
      contextSize: webSearchContextSize(settings.webSearchContextSize),
      allowedDomains: settings.webSearchAllowedDomains,
    },
    systemPrompt: instructions,
    supportsReasoning: model.supportsReasoning,
    replayReasoning,
  });

  runs().start({
    runId,
    threadId: thread.id,
    userId: args.userId,
    messageId: assistant.id,
    modelId: model.id,
    effort,
    body,
    rootThreadId,
    kind,
    parentRunId: args.parentRunId ?? null,
    modelHasPrice: model.hasPrice,
    tools,
    maxSteps: kind === "SUBAGENT" ? settings.subagentMaxSteps : settings.agentMaxSteps,
    usageKind: kind === "SUBAGENT" ? "SUBAGENT" : "CHAT",
    replayReasoning,
    firstStepToolChoice: args.firstStepToolChoice,
    meta: { ...args.meta, webSearch },
  });

  if (args.title && !thread.titleGenerated) {
    void generateTitle({
      userId: args.userId,
      threadId: thread.id,
      firstMessage: args.title.firstMessageText,
      fallbackModelId: model.id,
    }).then(async (title) => {
      await applyTitle(thread.id, title);
      runs().publish(runId, { type: "title", threadId: thread.id, title });
    });
  }

  return { runId, assistant: serializeMessage(assistant), thread: serializeThread(updatedThread) };
}

async function startAssistantTurn(args: {
  user: CurrentUser;
  thread: Thread;
  model: CatalogModel;
  effort: string | null;
  webSearch: boolean;
  after: Date;
  isFirstTurn: boolean;
  firstMessageText?: string;
}) {
  return launchAssistantRun({
    userId: args.user.id,
    thread: args.thread,
    model: args.model,
    effort: args.effort,
    webSearch: args.webSearch,
    after: args.after,
    title: args.isFirstTurn && args.firstMessageText ? { firstMessageText: args.firstMessageText } : null,
  });
}

function userParts(text: string, attachments: { id: string; mime: string }[]): MessagePart[] {
  const parts: MessagePart[] = [];
  for (const a of attachments) parts.push({ type: "user_image", id: `img_${a.id}`, attachmentId: a.id, mime: a.mime });
  if (text.trim()) parts.push({ type: "user_text", id: `txt_${randomUUID()}`, text });
  return parts;
}

async function claimAttachments(user: CurrentUser, ids: string[], model: CatalogModel) {
  if (ids.length === 0) return [];
  if (ids.length > MAX_IMAGES_PER_MESSAGE) throw badRequest(`You can attach up to ${MAX_IMAGES_PER_MESSAGE} images.`);
  if (!model.supportsImageInput) throw badRequest("This model doesn't accept images.");
  const atts = await db.attachment.findMany({ where: { id: { in: ids }, userId: user.id, messageId: null } });
  if (atts.length !== new Set(ids).size) throw badRequest("One or more attachments are invalid.");
  const order = new Map(ids.map((id, i) => [id, i]));
  return atts.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function sendMessage(
  user: CurrentUser,
  args: TurnOptions & { threadId?: string | null; text: string; attachmentIds: string[] },
) {
  const text = args.text.slice(0, 200_000);
  if (!text.trim() && args.attachmentIds.length === 0) throw badRequest("Write a message first.");

  const { model, effort, webSearch } = await resolveTurn(user, args);
  const attachments = await claimAttachments(user, args.attachmentIds, model);

  let thread: Thread;
  let isFirstTurn: boolean;
  if (args.threadId) {
    thread = await getOwnedThread(user, args.threadId);
    assertChatThread(thread);
    await assertNoActiveRun(thread.id);
    isFirstTurn = (await db.message.count({ where: { threadId: thread.id } })) === 0;
  } else {
    thread = await db.thread.create({
      data: { userId: user.id, webSearchEnabled: webSearch, lastModelId: model.id, lastEffort: effort },
    });
    isFirstTurn = true;
  }

  // Timestamps are set by the app (not the DB clock) so user → assistant ordering is always consistent.
  const userMessage = await db.message.create({
    data: {
      threadId: thread.id,
      role: "USER",
      parts: json(userParts(text, attachments)),
      status: "COMPLETE",
      createdAt: new Date(),
    },
  });
  if (attachments.length) {
    await db.attachment.updateMany({
      where: { id: { in: attachments.map((a) => a.id) } },
      data: { messageId: userMessage.id },
    });
  }

  const turn = await startAssistantTurn({
    user,
    thread,
    model,
    effort,
    webSearch,
    after: userMessage.createdAt,
    isFirstTurn,
    firstMessageText: text,
  });
  return { ...turn, userMessage: serializeMessage(userMessage) };
}

async function deleteMessagesAfter(threadId: string, pivot: Message, inclusive: boolean) {
  const later = await db.message.findMany({
    where: {
      threadId,
      OR: [{ createdAt: { gt: pivot.createdAt } }, ...(inclusive ? [{ id: pivot.id }] : [])],
    },
    select: { id: true },
  });
  const ids = later.map((m) => m.id).filter((id) => inclusive || id !== pivot.id);
  if (ids.length === 0) return;
  // Sub-agent threads spawned by the dropped turns go with them.
  const tasks = await db.subagentTask.findMany({ where: { parentMessageId: { in: ids } }, select: { childThreadId: true } });
  if (tasks.length) {
    await db.thread.updateMany({
      where: { id: { in: tasks.map((t) => t.childThreadId) } },
      data: { deletedAt: new Date() },
    });
  }
  await db.message.deleteMany({ where: { id: { in: ids } } });
}

async function getOwnedMessage(user: CurrentUser, messageId: string) {
  const message = await db.message.findUnique({ where: { id: messageId }, include: { thread: true } });
  if (!message || message.thread.userId !== user.id || message.thread.deletedAt) throw notFound("Message");
  return message;
}

/** Replace a user message's text, drop everything after it, and re-run. */
export async function editMessage(user: CurrentUser, messageId: string, args: TurnOptions & { text: string }) {
  const message = await getOwnedMessage(user, messageId);
  if (message.role !== "USER") throw badRequest("Only your own messages can be edited.");
  assertChatThread(message.thread);
  await assertNoActiveRun(message.threadId);
  const { model, effort, webSearch } = await resolveTurn(user, args);

  const oldParts = (message.parts as unknown as MessagePart[]) ?? [];
  const images = oldParts.filter((p) => p.type === "user_image");
  if (images.length && !model.supportsImageInput) throw badRequest("This model doesn't accept images.");
  const nextParts: MessagePart[] = [...images];
  if (args.text.trim()) nextParts.push({ type: "user_text", id: `txt_${randomUUID()}`, text: args.text.slice(0, 200_000) });
  if (nextParts.length === 0) throw badRequest("Write a message first.");

  await deleteMessagesAfter(message.threadId, message, false);
  const updated = await db.message.update({ where: { id: message.id }, data: { parts: json(nextParts) } });
  const isFirstTurn = (await db.message.count({ where: { threadId: message.threadId, createdAt: { lt: message.createdAt } } })) === 0;

  const turn = await startAssistantTurn({
    user,
    thread: message.thread,
    model,
    effort,
    webSearch,
    after: message.createdAt,
    isFirstTurn: isFirstTurn && !message.thread.titleGenerated,
    firstMessageText: args.text,
  });
  return { ...turn, userMessage: serializeMessage(updated) };
}

/** Drop an assistant reply (and anything after it) and generate a new one. */
export async function regenerateMessage(user: CurrentUser, messageId: string, args: TurnOptions) {
  const message = await getOwnedMessage(user, messageId);
  if (message.role !== "ASSISTANT") throw badRequest("Only assistant replies can be regenerated.");
  assertChatThread(message.thread);
  await assertNoActiveRun(message.threadId);
  const { model, effort, webSearch } = await resolveTurn(user, args);

  const previousUser = await db.message.findFirst({
    where: { threadId: message.threadId, role: "USER", createdAt: { lte: message.createdAt }, id: { not: message.id } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (!previousUser) throw badRequest("Nothing to regenerate from.");
  const hasImages = ((previousUser.parts as unknown as MessagePart[]) ?? []).some((p) => p.type === "user_image");
  if (hasImages && !model.supportsImageInput) throw badRequest("This model doesn't accept images.");

  await deleteMessagesAfter(message.threadId, message, true);
  return startAssistantTurn({
    user,
    thread: message.thread,
    model,
    effort,
    webSearch,
    after: previousUser.createdAt,
    isFirstTurn: false,
  });
}

const KIND_HINT: Record<string, string> = {
  markdown: "a markdown document",
  html: "a self-contained HTML page",
  react: "a React component",
};

/**
 * "New artifact" from the Artifacts page: creates a regular thread plus a GENERATING placeholder
 * artifact, and starts a run that is forced to call create_artifact first. Returns immediately.
 */
export async function startArtifactGeneration(
  user: CurrentUser,
  args: TurnOptions & { prompt: string; kind?: "markdown" | "html" | "react" | null },
) {
  const prompt = args.prompt.trim().slice(0, 20_000);
  if (!prompt) throw badRequest("Describe what you want to create.");
  const settings = await getSettings();
  if (!settings.artifactsEnabled) throw badRequest("Artifacts are turned off on this instance.");
  const { model, effort, webSearch } = await resolveTurn(user, args);
  if (!model.supportsFunctionTools) throw badRequest("That model can't create artifacts. Pick another one.");

  const thread = await db.thread.create({
    data: { userId: user.id, webSearchEnabled: webSearch, lastModelId: model.id, lastEffort: effort },
  });
  const userMessage = await db.message.create({
    data: {
      threadId: thread.id,
      role: "USER",
      parts: json(userParts(prompt, [])),
      status: "COMPLETE",
      createdAt: new Date(),
    },
  });
  const kind = args.kind ?? null;
  const artifact = await db.artifact.create({
    data: {
      userId: user.id,
      threadId: thread.id,
      title: prompt.split("\n")[0].slice(0, 80) || "New artifact",
      kind: kind === "html" ? "HTML" : kind === "react" ? "REACT" : "MARKDOWN",
      status: "GENERATING",
      currentVersion: 0,
    },
  });
  const suffix = [
    "The user started this thread from the Artifacts page, so they explicitly want an artifact.",
    `Create it with create_artifact${kind ? ` as ${KIND_HINT[kind]} (kind: ${kind})` : ", choosing the most suitable kind"}.`,
    "Gather anything you need first only if essential; then reply with a short summary of what you made.",
  ].join(" ");

  const turn = await launchAssistantRun({
    userId: user.id,
    thread,
    model,
    effort,
    webSearch,
    after: userMessage.createdAt,
    systemPromptSuffix: suffix,
    title: { firstMessageText: prompt },
    firstStepToolChoice: { type: "function", name: "create_artifact" },
    meta: { pendingArtifactId: artifact.id },
  });
  await db.artifact.update({ where: { id: artifact.id }, data: { runId: turn.runId } });
  return { artifactId: artifact.id, threadId: thread.id, runId: turn.runId, thread: turn.thread };
}
