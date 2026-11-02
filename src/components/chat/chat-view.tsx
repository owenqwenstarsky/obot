"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useChat, type TurnSettings } from "@/hooks/use-chat";
import { useModels } from "@/hooks/queries";
import { ApiError, errorMessage } from "@/lib/api";
import { resolveEffort, type AllowedEffort } from "@/lib/efforts";
import { useShellUser } from "@/components/app/user-context";
import { Composer } from "./composer";
import { AssistantMessage, UserMessage } from "./message";
import { SandboxFiles } from "./sandbox-files";
import type { CatalogModel } from "@/server/llm/catalog";

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

export function ChatView({ threadId: initialThreadId }: { threadId: string | null }) {
  const user = useShellUser();
  const chat = useChat(initialThreadId);
  const { data: modelsData, isLoading: modelsLoading } = useModels();
  const models = useMemo(() => modelsData?.models ?? [], [modelsData]);

  const [modelId, setModelId] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [webSearch, setWebSearch] = useState(false);
  const initialized = useRef(false);

  // Initialize the selection once models (and the thread, if any) are loaded.
  useEffect(() => {
    if (initialized.current || !modelsData || chat.loading) return;
    initialized.current = true;
    const last = readLastSelection();
    const byId = (id?: string | null) => (id ? models.find((m) => m.id === id) : undefined);
    const fromThread = byId(chat.meta?.lastModelId);
    // Priority: this thread's last model → explicit user default → last used anywhere → first model.
    const preferred = byId(modelsData.defaults.modelId);
    const model = fromThread ?? preferred ?? byId(last.modelId) ?? models[0];
    const wantedEffort = fromThread
      ? chat.meta?.lastEffort
      : preferred && preferred.id === model?.id
        ? modelsData.defaults.effort
        : last.modelId === model?.id
          ? last.effort
          : null;
    setModelId(model?.id ?? null);
    setEffort(effortFor(model, wantedEffort));
    setWebSearch(chat.meta?.webSearchEnabled ?? modelsData.defaults.webSearch);
  }, [modelsData, models, chat.loading, chat.meta]);

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
    if (!chat.loading) scrollToBottom();
  }, [chat.loading, scrollToBottom]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distance < 80;
    setShowJump(distance > 300);
  }

  const modelNames = useMemo(() => new Map(models.map((m) => [m.id, m.displayName])), [models]);
  const lastAssistantId = [...chat.messages].reverse().find((m) => m.role === "ASSISTANT")?.id;

  /** Send as a new turn; if the previous run is still wrapping up, retry briefly. */
  async function sendTurn(input: { text: string; attachments: { id: string; mime: string }[] }) {
    const s = settings();
    if (!s) throw new Error("Pick a model first.");
    stickToBottom.current = true;
    for (let attempt = 0; ; attempt++) {
      try {
        return await chat.send({ ...input, ...s });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && attempt < 10) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        throw err;
      }
    }
  }

  async function handleSubmit(input: { text: string; attachments: { id: string; mime: string }[] }) {
    if (chat.running && input.attachments.length === 0) {
      stickToBottom.current = true;
      if (await chat.steer(input.text)) return true;
    }
    return sendTurn(input);
  }

  async function handleInterrupt(input: { text: string; attachments: { id: string; mime: string }[] }) {
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
  const busy = chat.running || chat.sending;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {chat.threadId && (
        <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
          <SandboxFiles threadId={chat.threadId} running={chat.running} />
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
              Start a thread with the agent. Turn on <span className="font-medium text-foreground">Search</span> to let it browse
              the web and cite its sources.
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
            {chat.messages.map((m) =>
              m.role === "USER" ? (
                <UserMessage
                  key={m.id}
                  message={m}
                  canEdit={!busy && !m.id.startsWith("temp_")}
                  onEdit={(text) => handleEdit(m.id, text)}
                />
              ) : (
                <AssistantMessage
                  key={m.id}
                  message={m}
                  modelName={m.modelId ? (modelNames.get(m.modelId) ?? null) : null}
                  canRegenerate={!busy && m.id === lastAssistantId}
                  isLast={m.id === lastAssistantId}
                  onRegenerate={() => handleRegenerate(m.id)}
                />
              ),
            )}
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

      <div className="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-6 sm:pb-4">
        <Composer
          models={models}
          modelId={modelId}
          effort={effort}
          webSearch={webSearch}
          onModelChange={onModelChange}
          onWebSearchChange={onWebSearchChange}
          onSubmit={handleSubmit}
          onStop={() => void chat.stop()}
          onInterrupt={handleInterrupt}
          pendingSteers={chat.pendingSteers}
          running={chat.running}
          sending={chat.sending}
          context={chat.meta?.lastContext ?? null}
          spentMicros={chat.meta?.spentMicros ?? 0}
          autoFocus
        />
        <p className="mt-2 text-center text-[11px] text-muted-foreground/70">
          Agents can make mistakes. Check important info.
        </p>
      </div>
    </div>
  );
}
