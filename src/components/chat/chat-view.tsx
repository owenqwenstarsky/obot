"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, Bot, Columns2, CornerLeftUp, FolderOpen, Loader2, Square } from "lucide-react";
import { toast } from "sonner";
import { useChat, type TurnSettings } from "@/hooks/use-chat";
import { useLimits, useModels, useProject } from "@/hooks/queries";
import { worstWindow } from "@/components/app/spend-alerts";
import { formatUsd } from "@/lib/money";
import { ApiError, errorMessage } from "@/lib/api";
import { resolveEffort, type AllowedEffort } from "@/lib/efforts";
import { useShellUser } from "@/components/app/user-context";
import { Composer, type ComposerSubmit } from "./composer";
import { AssistantMessage, UserMessage } from "./message";
import { SandboxFiles } from "./sandbox-files";
import { ShareMenu } from "./share-menu";
import { ArtifactPanelHost } from "@/components/artifacts/artifact-panel";
import { ChatTasksContext } from "./tasks-context";
import { Button } from "@/components/ui/button";
import type { CatalogModel } from "@/server/llm/catalog";
import { branchInfo, compareGroup } from "@/lib/branches";
import { cn } from "@/lib/utils";

const LAST_SELECTION_KEY = "obot:last-selection";

function readLastSelection(): { modelId?: string; effort?: string | null } {
  try {
    return JSON.parse(localStorage.getItem(LAST_SELECTION_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function effortFor(model: CatalogModel | undefined, wanted: string | null | undefined): string | null {
  if (!model?.supportsReasoning) return null;
  return resolveEffort(wanted, model.efforts, (model.defaultEffort ?? undefined) as AllowedEffort | undefined);
}

export function ChatView({
  threadId: initialThreadId,
  projectId: newThreadProjectId = null,
  focusMessageId = null,
}: {
  threadId: string | null;
  /** For a new thread: start it inside this project. */
  projectId?: string | null;
  /** Scroll to (and if needed switch to the branch containing) this message, e.g. from search. */
  focusMessageId?: string | null;
}) {
  const user = useShellUser();
  const chat = useChat(initialThreadId, { projectId: newThreadProjectId });
  const projectId = chat.meta?.projectId ?? (initialThreadId ? null : newThreadProjectId);
  const { data: project, isLoading: projectLoading } = useProject(projectId);
  const { data: modelsData, isLoading: modelsLoading } = useModels();
  const models = useMemo(() => modelsData?.models ?? [], [modelsData]);

  const [modelId, setModelId] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [webSearch, setWebSearch] = useState(false);
  const [compare, setCompare] = useState<{ modelId: string; effort: string | null } | null>(null);
  const initialized = useRef(false);

  // Initialize the selection once models (and the thread, if any) are loaded.
  useEffect(() => {
    if (initialized.current || !modelsData || chat.loading || (projectId && projectLoading)) return;
    initialized.current = true;
    const last = readLastSelection();
    const byId = (id?: string | null) => (id ? models.find((m) => m.id === id) : undefined);
    const fromThread = byId(chat.meta?.lastModelId);
    const fromProject = byId(project?.defaultModelId);
    // Priority: this thread's last model → project default → explicit user default → last used anywhere → first model.
    const preferred = byId(modelsData.defaults.modelId);
    const model = fromThread ?? fromProject ?? preferred ?? byId(last.modelId) ?? models[0];
    const wantedEffort = fromThread
      ? chat.meta?.lastEffort
      : fromProject
        ? project?.defaultEffort
        : preferred && preferred.id === model?.id
          ? modelsData.defaults.effort
          : last.modelId === model?.id
            ? last.effort
            : null;
    setModelId(model?.id ?? null);
    setEffort(effortFor(model, wantedEffort));
    setWebSearch(chat.meta?.webSearchEnabled ?? project?.webSearchDefault ?? modelsData.defaults.webSearch);
  }, [modelsData, models, chat.loading, chat.meta, projectId, projectLoading, project]);

  const onModelChange = useCallback(
    (id: string, e: string | null) => {
      setModelId(id);
      const m = models.find((x) => x.id === id);
      const next = effortFor(m, e);
      setEffort(next);
      localStorage.setItem(LAST_SELECTION_KEY, JSON.stringify({ modelId: id, effort: next }));
    },
    [models],
  );

  const onWebSearchChange = useCallback(
    (enabled: boolean) => {
      setWebSearch(enabled);
      chat.setWebSearchForThread(enabled);
    },
    [chat],
  );

  const settings = useCallback((): TurnSettings | null => {
    if (!modelId) return null;
    const m = models.find((x) => x.id === modelId);
    return { modelId, effort, webSearch: webSearch && !!m?.supportsWebSearch };
  }, [modelId, effort, webSearch, models]);

  // ── Scrolling ──
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useLayoutEffect(() => {
    if (stickToBottom.current) scrollToBottom();
  }, [chat.messages, scrollToBottom]);

  useEffect(() => {
    if (!chat.loading && !focusMessageId) scrollToBottom();
  }, [chat.loading, scrollToBottom, focusMessageId]);

  // Jump to a message from search: switch to its branch if needed, then scroll and flash it.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const focusDone = useRef(false);
  const { loading: chatLoading, allMessages: everyMessage, messages: visibleMessages, switchBranch: switchTo, threadId: currentThreadId } = chat;
  useEffect(() => {
    if (!focusMessageId || focusDone.current || chatLoading) return;
    if (!everyMessage.some((m) => m.id === focusMessageId)) {
      focusDone.current = true;
      return;
    }
    if (!visibleMessages.some((m) => m.id === focusMessageId)) {
      void switchTo(focusMessageId).catch(() => undefined);
      return;
    }
    focusDone.current = true;
    stickToBottom.current = false;
    requestAnimationFrame(() => {
      document.getElementById(`msg-${focusMessageId}`)?.scrollIntoView({ block: "center" });
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- brief highlight after navigation
    setHighlightId(focusMessageId);
    // Not cleared on re-render: the effect won't run again for this focus (focusDone), so the timer must survive.
    setTimeout(() => setHighlightId(null), 2500);
    window.history.replaceState(null, "", `/t/${currentThreadId}`);
  }, [focusMessageId, chatLoading, everyMessage, visibleMessages, switchTo, currentThreadId]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distance < 80;
    setShowJump(distance > 300);
  }

  const modelNames = useMemo(() => new Map(models.map((m) => [m.id, m.displayName])), [models]);
  const { tasks: chatTasks, cancelTask } = chat;
  const tasksApi = useMemo(
    () => ({ tasks: new Map(chatTasks.map((t) => [t.id, t])), cancel: cancelTask }),
    [chatTasks, cancelTask],
  );
  const isSubagent = chat.meta?.kind === "SUBAGENT";
  const { data: limits } = useLimits();
  const tight = worstWindow(limits);
  const spendNotice = tight ? (
    <span className={tight.alert === "reached" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}>
      {tight.alert === "reached"
        ? `${tight.window === "weekly" ? "Weekly" : "Monthly"} spend limit reached (${formatUsd(tight.spentMicros)} of ${formatUsd(tight.limitMicros!)}). `
        : `${Math.floor((tight.spentMicros / tight.limitMicros!) * 100)}% of your ${tight.window} limit used: ${formatUsd(tight.limitMicros! - tight.spentMicros)} left. `}
      <Link href="/usage" className="underline-offset-2 hover:underline">
        See usage
      </Link>
    </span>
  ) : null;
  const childTask = chat.meta?.task ?? null;
  const lastAssistantId = [...chat.messages].reverse().find((m) => m.role === "ASSISTANT")?.id;
  const { allMessages, switchBranch } = chat;
  const branches = useMemo(() => new Map(chat.messages.map((m) => [m.id, branchInfo(allMessages, m)])), [allMessages, chat.messages]);
  /** Assistant messages on the path that are part of a side-by-side comparison → all replies in the group. */
  const compareGroups = useMemo(() => {
    const out = new Map<string, typeof allMessages>();
    for (const m of chat.messages) {
      if (m.role !== "ASSISTANT" || !m.compareGroupId) continue;
      const group = compareGroup(allMessages, m);
      if (group.length > 1) out.set(m.id, group);
    }
    return out;
  }, [allMessages, chat.messages]);
  const onSwitchBranch = useCallback(
    (id: string) => {
      void switchBranch(id).catch((err) => toast.error(errorMessage(err)));
    },
    [switchBranch],
  );

  /** Send as a new turn; if the previous run is still wrapping up, retry briefly. */
  async function sendTurn(input: ComposerSubmit) {
    const s = settings();
    if (!s) throw new Error("Pick a model first.");
    stickToBottom.current = true;
    const versus = compare && !chat.running ? { modelId: compare.modelId, effort: compare.effort } : null;
    for (let attempt = 0; ; attempt++) {
      try {
        const ok = await chat.send({ ...input, ...s, compare: versus });
        // A comparison is a one-off: the next message goes to the selected model only.
        if (versus) setCompare(null);
        return ok;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && attempt < 10) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        throw err;
      }
    }
  }

  async function handleSubmit(input: ComposerSubmit) {
    if (chat.running && !chat.activeRun) {
      throw new Error("Wait for both replies to finish, or stop them first.");
    }
    if (chat.running && input.attachments.length === 0) {
      stickToBottom.current = true;
      if (await chat.steer(input.text)) return true;
    }
    return sendTurn(input);
  }

  async function handleInterrupt(input: ComposerSubmit) {
    stickToBottom.current = true;
    const ok = await chat.interrupt(input.text.trim() || undefined);
    if (!ok && input.text.trim()) return sendTurn(input);
    return true;
  }

  async function handleEdit(messageId: string, text: string) {
    const s = settings();
    if (!s) return;
    stickToBottom.current = true;
    try {
      await chat.edit(messageId, text, s);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  }

  async function handleRegenerate(messageId: string) {
    const s = settings();
    if (!s) return;
    stickToBottom.current = true;
    try {
      await chat.regenerate(messageId, s);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (chat.notFound) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-medium">Thread not found</p>
        <p className="text-sm text-muted-foreground">It may have been deleted.</p>
        <Link href="/" className="text-sm text-primary hover:underline">
          Start a new thread
        </Link>
      </div>
    );
  }

  const empty = !chat.loading && chat.messages.length === 0;
  const busy = chat.running || chat.sending || isSubagent;

  return (
    <ChatTasksContext.Provider value={tasksApi}>
      <ArtifactPanelHost>
        {isSubagent && chat.meta?.parent && (
          <div className="absolute inset-x-0 top-0 z-10 flex justify-center px-4 pt-3 md:pl-28">
            <div className="flex max-w-full items-center gap-2 rounded-full border bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur">
              <Bot className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="shrink-0 text-muted-foreground">Sub-agent of</span>
              <Link href={`/t/${chat.meta.parent.id}`} className="flex min-w-0 items-center gap-1 font-medium hover:underline">
                <CornerLeftUp className="size-3 shrink-0" />
                <span className="truncate">{chat.meta.parent.title}</span>
              </Link>
              {childTask && (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {chat.running ? "Running" : childTask.status.charAt(0) + childTask.status.slice(1).toLowerCase()}
                </span>
              )}
            </div>
          </div>
        )}
        {chat.threadId && (
          <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
            <SandboxFiles threadId={chat.threadId} running={chat.running} />
            {!isSubagent && chat.messages.length > 0 && <ShareMenu threadId={chat.threadId} disabled={chat.sending} />}
          </div>
        )}
        <div ref={scrollRef} onScroll={onScroll} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          {chat.loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : empty ? (
            <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-6 pb-24 text-center">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                How can I help, {user.name.split(" ")[0]}?
              </h1>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {project ? (
                  <>
                    New thread in <span className="font-medium text-foreground">{project.name}</span>. The agent will follow the
                    project&apos;s instructions and files.
                  </>
                ) : (
                  "Start a thread with the agent."
                )}
              </p>
              {!modelsLoading && models.length === 0 && (
                <p className="mt-6 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                  No models are enabled yet.{" "}
                  {user.role === "ADMIN" ? (
                    <Link href="/admin/models" className="text-primary hover:underline">
                      Enable models in Admin
                    </Link>
                  ) : (
                      "Ask an admin to enable some."
                  )}
                </p>
              )}
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 pt-14 pb-8 sm:px-6">
              {chat.messages.map((m) => (
                <div
                  key={m.id}
                  id={`msg-${m.id}`}
                  className={cn("scroll-mt-16 rounded-2xl transition-shadow duration-700", highlightId === m.id && "ring-2 ring-primary/40 ring-offset-4 ring-offset-background")}
                >
                {m.role === "USER" ? (
                  <UserMessage
                    key={m.id}
                    message={m}
                    canEdit={!busy && !m.id.startsWith("temp_")}
                    onEdit={(text) => handleEdit(m.id, text)}
                    branch={branches.get(m.id)}
                    onSwitchBranch={onSwitchBranch}
                    branchDisabled={busy}
                  />
                ) : compareGroups.get(m.id) ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:-mx-24">
                    {compareGroups.get(m.id)!.map((c) => {
                      const selected = c.id === m.id;
                      return (
                        <div
                          key={c.id}
                          className={cn(
                            "min-w-0 rounded-2xl border p-4",
                            selected ? "border-primary/40 bg-card" : "border-dashed bg-card/40",
                          )}
                        >
                          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                            <Columns2 className="size-3.5" />
                            <span className="truncate font-medium text-foreground/85">
                              {c.modelId ? (modelNames.get(c.modelId) ?? c.modelId) : "Model"}
                            </span>
                            {selected && <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">Continuing</span>}
                          </div>
                          <AssistantMessage
                            message={c}
                            modelName={c.modelId ? (modelNames.get(c.modelId) ?? null) : null}
                            canRegenerate={!busy && selected}
                            isLast={c.id === lastAssistantId}
                            onRegenerate={() => handleRegenerate(c.id)}
                            branch={selected ? branches.get(c.id) : null}
                            onSwitchBranch={onSwitchBranch}
                            branchDisabled={busy}
                            footer={
                              !selected && c.status !== "STREAMING" ? (
                                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => onSwitchBranch(c.id)}>
                                  Continue with this
                                </Button>
                              ) : null
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <AssistantMessage
                    key={m.id}
                    message={m}
                    modelName={m.modelId ? (modelNames.get(m.modelId) ?? null) : null}
                    canRegenerate={!busy}
                    isLast={m.id === lastAssistantId}
                    onRegenerate={() => handleRegenerate(m.id)}
                    branch={branches.get(m.id)}
                    onSwitchBranch={onSwitchBranch}
                    branchDisabled={busy}
                  />
                )}
                </div>
              ))}
            </div>
          )}
        </div>

        {showJump && (
          <button
            type="button"
            onClick={() => {
              stickToBottom.current = true;
              scrollToBottom(true);
            }}
            className="absolute bottom-36 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-md hover:text-foreground"
          >
            <ArrowDown className="size-3.5" /> Jump to latest
          </button>
        )}

        {isSubagent ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-2 px-3 pb-4 sm:px-6">
            {chat.running && childTask ? (
              <Button
                variant="outline"
                onClick={() => {
                  void chat.cancelTask(childTask.id).catch((err) => toast.error(errorMessage(err)));
                }}
              >
                <Square className="size-3 fill-current" /> Cancel sub-agent
              </Button>
            ) : null}
            <p className="text-center text-xs text-muted-foreground">
              Sub-agent threads are read-only. Their final message is sent back to the parent agent.
            </p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-6 sm:pb-4">
            {project && (
              <div className="mb-2 flex justify-center">
                <Link
                  href={`/projects/${project.id}`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <FolderOpen className="size-3.5 shrink-0" />
                  <span className="truncate">{project.name}</span>
                </Link>
              </div>
            )}
            <Composer
              models={models}
              modelId={modelId}
              effort={effort}
              webSearch={webSearch}
              onModelChange={onModelChange}
              onWebSearchChange={onWebSearchChange}
              onSubmit={handleSubmit}
              onStop={() => void chat.stop()}
              onInterrupt={chat.running && !chat.activeRun ? undefined : handleInterrupt}
              pendingSteers={chat.pendingSteers}
              running={chat.running}
              sending={chat.sending}
              context={chat.meta?.lastContext ?? null}
              spentMicros={chat.meta?.spentMicros ?? 0}
              compare={compare}
              onCompareChange={setCompare}
              notice={spendNotice}
              autoFocus
            />
            <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
              Agents can make mistakes. Check important info.
            </p>
          </div>
        )}
      </ArtifactPanelHost>
    </ChatTasksContext.Provider>
  );
}
