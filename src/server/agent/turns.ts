import "server-only";
import { randomUUID } from "node:crypto";
import type { Message, Prisma, Thread } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { HttpError, badRequest, notFound } from "@/server/auth/errors";
import type { CurrentUser } from "@/server/auth/session";
import { getSelectableModel } from "@/server/llm/models";
import type { CatalogModel } from "@/server/llm/catalog";
import { buildResponsesRequest, type HistoryMessage, type ResolvedDocument } from "@/server/llm/request-builder";
import { checkCanRun } from "@/server/billing/usage";
import { getAgentFlags, getSettings, webSearchContextSize } from "@/server/settings";
import { attachmentDataUrl, readAttachmentBytes, readAttachmentText } from "@/server/uploads/storage";
import { MAX_ATTACHMENTS_PER_MESSAGE, sanitizeFileName } from "@/server/uploads/document-type";
import { sandboxes } from "@/server/sandbox";
import type { Attachment } from "@/generated/prisma/client";
import { runs } from "@/server/agent/runtime";
import { applyTitle, generateTitle } from "@/server/agent/titles";
import { serializeMessage, serializeThread } from "@/server/agent/serialize";
import { resolveEffort } from "@/lib/efforts";
import { partsToSearchText, type MessagePart, type UserFilePart } from "@/lib/parts";
import { toolRegistry } from "@/server/agent/tools";
import { buildInstructions, MEMORY_PROMPT_LIMIT } from "@/server/agent/system-prompt";
import { listMemories } from "@/server/memories";
import { activePath } from "@/lib/branches";
import { getOwnedProject, loadProjectContext, syncProjectFilesToSandbox } from "@/server/projects";
import type { ProjectContext } from "@/server/projects-core";
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

type LoadedHistory = {
  history: HistoryMessage[];
  images: Map<string, string>;
  documents: Map<string, ResolvedDocument>;
};

/** Load image data URLs and document text referenced by user parts. */
async function resolveAttachments(history: HistoryMessage[]): Promise<Omit<LoadedHistory, "history">> {
  const imageIds: string[] = [];
  const docIds: string[] = [];
  for (const h of history) {
    for (const p of h.parts) {
      if (p.type === "user_image") imageIds.push(p.attachmentId);
      else if (p.type === "user_file") docIds.push(p.attachmentId);
    }
  }
  const images = new Map<string, string>();
  const documents = new Map<string, ResolvedDocument>();
  const ids = [...new Set([...imageIds, ...docIds])];
  if (ids.length) {
    const atts = await db.attachment.findMany({ where: { id: { in: ids } } });
    await Promise.all(
      atts.map(async (a) => {
        if (a.kind === "IMAGE") {
          const url = await attachmentDataUrl(a.path, a.mime);
          if (url) images.set(a.id, url);
        } else {
          const text = await readAttachmentText(a);
          if (text != null) documents.set(a.id, { fileName: a.fileName, text });
        }
      }),
    );
  }
  return { images, documents };
}

/** The conversation on the branch ending at `leafId` (root first), with attachment data resolved. */
async function loadHistory(threadId: string, leafId: string): Promise<LoadedHistory> {
  const nodes = await db.message.findMany({ where: { threadId }, select: { id: true, parentId: true, createdAt: true } });
  const pathIds = activePath(nodes, leafId).map((n) => n.id);
  const rows = await db.message.findMany({ where: { id: { in: pathIds } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const history: HistoryMessage[] = pathIds
    .map((id) => byId.get(id))
    .filter((m): m is Message => !!m)
    .map((m) => ({
      role: m.role,
      parts: (m.parts as unknown as MessagePart[]) ?? [],
      transcript: m.rawOutput,
    }));
  return { history, ...(await resolveAttachments(history)) };
}

/** Where a new user message attaches: the thread's current leaf (or its newest message for legacy rows). */
async function resolveLeafId(thread: Thread): Promise<string | null> {
  if (thread.currentLeafId) {
    const leaf = await db.message.findFirst({ where: { id: thread.currentLeafId, threadId: thread.id }, select: { id: true } });
    if (leaf) return leaf.id;
  }
  const newest = await db.message.findFirst({
    where: { threadId: thread.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  return newest?.id ?? null;
}

export type LaunchRunArgs = {
  userId: string;
  thread: Thread;
  model: CatalogModel;
  effort: string | null;
  webSearch: boolean;
  /** The message this reply answers (normally a user message); created 1ms after it so ordering is stable. */
  parent: { id: string; createdAt: Date };
  /** Shared by replies generated side by side for a model comparison. */
  compareGroupId?: string | null;
  /** Make this reply the thread's current leaf (default true). */
  setLeaf?: boolean;
  /** Include the user's custom instructions and memories (default true; chat threads only). */
  personalize?: boolean;
  /** Include memories and the remember/forget tools when the user has memory on (default true). */
  memories?: boolean;
  /** Only offer tools without shared state (web search, fetch_url): used for model comparisons. */
  statelessTools?: boolean;
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
  const instanceFlags = await getAgentFlags(settings);
  // Personalization applies to the user's own chats; sub-agents only get their brief.
  const prefs =
    kind === "CHAT"
      ? await db.user.findUnique({ where: { id: args.userId }, select: { aboutMe: true, responseStyle: true, memoryEnabled: true } })
      : null;
  const memoryOn = !!(instanceFlags.memoryEnabled && prefs?.memoryEnabled && args.personalize !== false && args.memories !== false);
  const flags = args.statelessTools
    ? // Model comparisons run side by side: only tools that can't interfere with each other.
      { ...instanceFlags, memoryEnabled: false, sandboxEnabled: false, artifactsEnabled: false, subagentsEnabled: false }
    : { ...instanceFlags, memoryEnabled: memoryOn };
  const tools = toolRegistry.select({ threadKind: kind, model, flags });
  const memories = memoryOn ? (await listMemories(args.userId, MEMORY_PROMPT_LIMIT)).map((m) => ({ id: m.id, content: m.content })) : null;
  const rootThreadId = args.rootThreadId ?? thread.parentThreadId ?? thread.id;
  let project: ProjectContext | null = null;
  if (kind === "CHAT" && thread.projectId) {
    const sandboxDir = tools.has("bash") ? await syncProjectFilesToSandbox(thread.projectId, rootThreadId) : null;
    project = await loadProjectContext(thread.projectId, { sandboxDir });
  }
  const instructions = buildInstructions({
    adminPrompt: settings.systemPrompt,
    kind,
    toolNames: tools.names(),
    flags,
    suffix: args.systemPromptSuffix,
    project,
    user: prefs && args.personalize !== false ? prefs : null,
    memories,
  });
  const createdAt = new Date(Math.max(Date.now(), args.parent.createdAt.getTime() + 1));
  const runId = randomUUID();

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
      parentId: args.parent.id,
      compareGroupId: args.compareGroupId ?? null,
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
    // A secondary comparison reply doesn't change the thread's selection or visible branch.
    data:
      args.setLeaf === false
        ? { lastMessageAt: createdAt }
        : { lastModelId: model.id, lastEffort: effort, webSearchEnabled: webSearch, lastMessageAt: createdAt, currentLeafId: assistant.id },
  });

  const { history, images, documents } = await loadHistory(thread.id, args.parent.id);
  const replayReasoning = model.replayReasoning && tools.size > 0;
  const body = buildResponsesRequest({
    model: model.id,
    effort: effort as never,
    history,
    resolveImage: (id) => images.get(id) ?? null,
    resolveDocument: (id) => documents.get(id) ?? null,
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
  parent: Message;
  isFirstTurn: boolean;
  firstMessageText?: string;
}) {
  return launchAssistantRun({
    userId: args.user.id,
    thread: args.thread,
    model: args.model,
    effort: args.effort,
    webSearch: args.webSearch,
    parent: args.parent,
    title: args.isFirstTurn && args.firstMessageText ? { firstMessageText: args.firstMessageText } : null,
  });
}

function userParts(text: string, attachments: Attachment[], sandboxPaths: Map<string, string> = new Map()): MessagePart[] {
  const parts: MessagePart[] = [];
  for (const a of attachments) {
    if (a.kind === "IMAGE") {
      parts.push({ type: "user_image", id: `img_${a.id}`, attachmentId: a.id, mime: a.mime });
    } else {
      const part: UserFilePart = {
        type: "user_file",
        id: `file_${a.id}`,
        attachmentId: a.id,
        fileName: a.fileName,
        mime: a.mime,
        size: a.size,
        chars: a.textChars ?? 0,
      };
      const sandboxPath = sandboxPaths.get(a.id);
      if (sandboxPath) part.sandboxPath = sandboxPath;
      parts.push(part);
    }
  }
  if (text.trim()) parts.push({ type: "user_text", id: `txt_${randomUUID()}`, text });
  return parts;
}

function hasImages(parts: MessagePart[]) {
  return parts.some((p) => p.type === "user_image");
}

async function claimAttachments(user: CurrentUser, ids: string[], model: CatalogModel) {
  if (ids.length === 0) return [];
  if (ids.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw badRequest(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
  }
  const atts = await db.attachment.findMany({ where: { id: { in: ids }, userId: user.id, messageId: null, projectId: null } });
  if (atts.length !== new Set(ids).size) throw badRequest("One or more attachments are invalid.");
  if (!model.supportsImageInput && atts.some((a) => a.kind === "IMAGE")) throw badRequest("This model doesn't accept images.");
  const order = new Map(ids.map((id, i) => [id, i]));
  return atts.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/**
 * Copy document uploads into the thread's sandbox (`/home/user/uploads`) so the agent can
 * work with the full file. Best-effort: failures just mean no sandbox copy.
 */
async function copyDocumentsToSandbox(sandboxId: string, attachments: Attachment[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const docs = attachments.filter((a) => a.kind === "DOCUMENT");
  if (docs.length === 0) return out;
  const settings = await getSettings();
  if (!settings.sandboxEnabled) return out;
  try {
    const files = await Promise.all(
      docs.map(async (a) => ({ id: a.id, name: sanitizeFileName(a.fileName), bytes: new Uint8Array(await readAttachmentBytes(a.path)) })),
    );
    const paths = await sandboxes().addFiles(sandboxId, "uploads", files, "unique");
    files.forEach((f, i) => out.set(f.id, paths[i]));
  } catch (err) {
    console.warn("[uploads] could not copy files into the sandbox:", err);
  }
  return out;
}

export async function sendMessage(
  user: CurrentUser,
  args: TurnOptions & {
    threadId?: string | null;
    text: string;
    attachmentIds: string[];
    projectId?: string | null;
    /** Also answer with this model, side by side (model comparison). */
    compare?: { modelId: string; effort?: string | null } | null;
  },
) {
  const text = args.text.slice(0, 200_000);
  if (!text.trim() && args.attachmentIds.length === 0) throw badRequest("Write a message first.");

  const { model, effort, webSearch } = await resolveTurn(user, args);
  const versus = args.compare
    ? await resolveTurn(user, { modelId: args.compare.modelId, effort: args.compare.effort, webSearch: args.webSearch })
    : null;
  if (versus && versus.model.id === model.id && versus.effort === effort) {
    throw badRequest("Pick a different model or effort to compare against.");
  }
  const attachments = await claimAttachments(user, args.attachmentIds, model);
  if (versus && !versus.model.supportsImageInput && attachments.some((a) => a.kind === "IMAGE")) {
    throw badRequest(`${versus.model.displayName} doesn't accept images, so it can't be compared on this message.`);
  }

  let thread: Thread;
  let isFirstTurn: boolean;
  let parentId: string | null = null;
  if (args.threadId) {
    thread = await getOwnedThread(user, args.threadId);
    assertChatThread(thread);
    await assertNoActiveRun(thread.id);
    parentId = await resolveLeafId(thread);
    isFirstTurn = parentId == null;
  } else {
    const projectId = args.projectId ? (await getOwnedProject(user, args.projectId)).id : null;
    thread = await db.thread.create({
      data: { userId: user.id, webSearchEnabled: webSearch, lastModelId: model.id, lastEffort: effort, projectId },
    });
    isFirstTurn = true;
  }

  const sandboxPaths = await copyDocumentsToSandbox(thread.parentThreadId ?? thread.id, attachments);
  const parts = userParts(text, attachments, sandboxPaths);
  // Timestamps are set by the app (not the DB clock) so user → assistant ordering is always consistent.
  const userMessage = await db.message.create({
    data: {
      threadId: thread.id,
      role: "USER",
      parts: json(parts),
      searchText: partsToSearchText(parts),
      status: "COMPLETE",
      createdAt: new Date(),
      parentId,
    },
  });
  if (attachments.length) {
    await db.attachment.updateMany({
      where: { id: { in: attachments.map((a) => a.id) } },
      data: { messageId: userMessage.id },
    });
  }

  if (!versus) {
    const turn = await startAssistantTurn({
      user,
      thread,
      model,
      effort,
      webSearch,
      parent: userMessage,
      isFirstTurn,
      firstMessageText: text,
    });
    return { ...turn, userMessage: serializeMessage(userMessage) };
  }

  // Model comparison: two sibling replies to the same message, generated at the same time.
  const compareGroupId = randomUUID();
  const turn = await launchAssistantRun({
    userId: user.id,
    thread,
    model,
    effort,
    webSearch,
    parent: userMessage,
    title: isFirstTurn && text ? { firstMessageText: text } : null,
    compareGroupId,
    statelessTools: true,
  });
  const second = await launchAssistantRun({
    userId: user.id,
    thread,
    model: versus.model,
    effort: versus.effort,
    webSearch: versus.webSearch,
    parent: userMessage,
    compareGroupId,
    statelessTools: true,
    setLeaf: false,
    meta: { compareSecondary: true },
  });
  return {
    ...turn,
    userMessage: serializeMessage(userMessage),
    compare: [{ runId: second.runId, assistant: second.assistant }],
  };
}

async function getOwnedMessage(user: CurrentUser, messageId: string) {
  const message = await db.message.findUnique({ where: { id: messageId }, include: { thread: true } });
  if (!message || message.thread.userId !== user.id || message.thread.deletedAt) throw notFound("Message");
  return message;
}

/** Edit a user message: adds the new text as a sibling of the original (nothing is deleted) and re-runs. */
export async function editMessage(user: CurrentUser, messageId: string, args: TurnOptions & { text: string }) {
  const message = await getOwnedMessage(user, messageId);
  if (message.role !== "USER") throw badRequest("Only your own messages can be edited.");
  assertChatThread(message.thread);
  await assertNoActiveRun(message.threadId);
  const { model, effort, webSearch } = await resolveTurn(user, args);

  const oldParts = (message.parts as unknown as MessagePart[]) ?? [];
  const files = oldParts.filter((p) => p.type === "user_image" || p.type === "user_file");
  if (hasImages(files) && !model.supportsImageInput) throw badRequest("This model doesn't accept images.");
  const nextParts: MessagePart[] = [...files];
  if (args.text.trim()) nextParts.push({ type: "user_text", id: `txt_${randomUUID()}`, text: args.text.slice(0, 200_000) });
  if (nextParts.length === 0) throw badRequest("Write a message first.");

  const edited = await db.message.create({
    data: {
      threadId: message.threadId,
      role: "USER",
      parts: json(nextParts),
      searchText: partsToSearchText(nextParts),
      status: "COMPLETE",
      createdAt: new Date(),
      parentId: message.parentId,
    },
  });
  const turn = await startAssistantTurn({
    user,
    thread: message.thread,
    model,
    effort,
    webSearch,
    parent: edited,
    isFirstTurn: message.parentId == null && !message.thread.titleGenerated,
    firstMessageText: args.text,
  });
  return { ...turn, userMessage: serializeMessage(edited) };
}

/** Generate another reply to the same message, as a sibling of `messageId` (the old reply is kept). */
export async function regenerateMessage(user: CurrentUser, messageId: string, args: TurnOptions) {
  const message = await getOwnedMessage(user, messageId);
  if (message.role !== "ASSISTANT") throw badRequest("Only assistant replies can be regenerated.");
  assertChatThread(message.thread);
  await assertNoActiveRun(message.threadId);
  const { model, effort, webSearch } = await resolveTurn(user, args);

  const parent = message.parentId
    ? await db.message.findFirst({ where: { id: message.parentId, threadId: message.threadId } })
    : null;
  if (!parent) throw badRequest("Nothing to regenerate from.");
  if (hasImages((parent.parts as unknown as MessagePart[]) ?? []) && !model.supportsImageInput) {
    throw badRequest("This model doesn't accept images.");
  }
  return startAssistantTurn({
    user,
    thread: message.thread,
    model,
    effort,
    webSearch,
    parent,
    isFirstTurn: false,
  });
}

/** Show a different branch: `leafId` must be a message in the thread. */
export async function setCurrentLeaf(user: CurrentUser, threadId: string, leafId: string) {
  const thread = await getOwnedThread(user, threadId);
  await assertNoActiveRun(thread.id);
  const leaf = await db.message.findFirst({ where: { id: leafId, threadId: thread.id }, select: { id: true } });
  if (!leaf) throw notFound("Message");
  return db.thread.update({ where: { id: thread.id }, data: { currentLeafId: leaf.id } });
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
      searchText: prompt,
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
    parent: userMessage,
    systemPromptSuffix: suffix,
    title: { firstMessageText: prompt },
    firstStepToolChoice: { type: "function", name: "create_artifact" },
    meta: { pendingArtifactId: artifact.id },
    memories: false,
  });
  await db.artifact.update({ where: { id: artifact.id }, data: { runId: turn.runId } });
  return { artifactId: artifact.id, threadId: thread.id, runId: turn.runId, thread: turn.thread };
}
