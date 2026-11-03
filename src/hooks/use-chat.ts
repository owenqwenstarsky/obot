"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { applyPartOps, type PartOp } from "@/lib/part-ops";
import type { ContextSnapshot, MessagePart } from "@/lib/parts";
import type { ClientTask, PendingSteer, RunEvent, RunPhase } from "@/lib/run-events";
import type { ClientAttachment, ClientMessage, ClientThread, ClientThreadDetail } from "@/server/agent/serialize";
import type { ThreadListItem } from "@/hooks/queries";
import { activePath, deepestLeaf } from "@/lib/branches";

export type TurnSettings = { modelId: string; effort: string | null; webSearch: boolean };

type TurnResponse = {
  runId: string;
  assistant: ClientMessage;
  thread: ClientThread;
  userMessage?: ClientMessage;
  /** Extra side-by-side replies (model comparison). */
  compare?: { runId: string; assistant: ClientMessage }[];
};

export type ThreadMeta = {
  id: string;
  title: string;
  webSearchEnabled: boolean | null;
  lastModelId: string | null;
  lastEffort: string | null;
  lastContext: ContextSnapshot | null;
  spentMicros: number;
  kind: "CHAT" | "SUBAGENT";
  parent: { id: string; title: string } | null;
  task: ClientTask | null;
  projectId: string | null;
};

/** `primary` runs drive the thread's context meter; comparison runs don't. */
type ActiveRun = { id: string; messageId: string; primary: boolean };

const MAX_RECONNECTS = 20;

/** Parse complete SSE frames out of a text buffer. Returns parsed events and the leftover buffer. */
function parseSse(buffer: string): { events: RunEvent[]; rest: string } {
  const events: RunEvent[] = [];
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  for (const frame of frames) {
    const data = frame
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as RunEvent);
    } catch {
      // ignore malformed frame
    }
  }
  return { events, rest };
}

export function useChat(initialThreadId: string | null, opts: { projectId?: string | null } = {}) {
  const projectId = opts.projectId ?? null;
  const qc = useQueryClient();
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [meta, setMeta] = useState<ThreadMeta | null>(null);
  /** Every message on every branch. */
  const [allMessages, setMessages] = useState<ClientMessage[]>([]);
  const [leafId, setLeafId] = useState<string | null>(null);
  const [activeRuns, setActiveRuns] = useState<ActiveRun[]>([]);
  const [loading, setLoading] = useState<boolean>(!!initialThreadId);
  const [notFound, setNotFound] = useState(false);
  const [sending, setSending] = useState(false);
  const [phase, setPhase] = useState<RunPhase | null>(null);
  const [pendingSteers, setPendingSteers] = useState<PendingSteer[]>([]);
  const [tasks, setTasks] = useState<ClientTask[]>([]);

  const streams = useRef(new Map<string, AbortController>());
  const seqs = useRef(new Map<string, number>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const live = streams.current;
    return () => {
      mounted.current = false;
      for (const c of live.values()) c.abort();
      live.clear();
    };
  }, []);

  /** The conversation currently shown: root → current leaf. */
  const messages = useMemo(() => activePath(allMessages, leafId), [allMessages, leafId]);

  const applyDetail = useCallback((d: ClientThreadDetail) => {
    setMeta({
      id: d.id,
      title: d.title,
      webSearchEnabled: d.webSearchEnabled,
      lastModelId: d.lastModelId,
      lastEffort: d.lastEffort,
      lastContext: d.lastContext,
      spentMicros: d.spentMicros,
      kind: d.kind,
      parent: d.parent,
      task: d.task,
      projectId: d.projectId,
    });
    setTasks(d.tasks);
    return d;
  }, []);

  const setThreadTitle = useCallback(
    (id: string, title: string) => {
      setMeta((m) => (m && m.id === id ? { ...m, title } : m));
      qc.setQueryData<ThreadListItem[]>(["threads"], (old) => old?.map((t) => (t.id === id ? { ...t, title } : t)));
    },
    [qc],
  );

  const refreshMeta = useCallback(
    async (id: string) => {
      try {
        const { thread } = await api<{ thread: ClientThreadDetail }>(`/api/threads/${id}`);
        if (!mounted.current) return;
        applyDetail(thread);
        setThreadTitle(thread.id, thread.title);
        // Pick up server-side usage numbers for messages.
        setMessages((prev) =>
          prev.map((m) => {
            const fresh = thread.messages.find((x) => x.id === m.id);
            return fresh && m.status !== "STREAMING" ? { ...m, usage: fresh.usage } : m;
          }),
        );
      } catch {
        // non-fatal
      }
    },
    [applyDetail, setThreadTitle],
  );

  const updateMessage = useCallback((id: string, fn: (m: ClientMessage) => ClientMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const markThreadRunning = useCallback(
    (id: string, running: boolean) => {
      qc.setQueryData<ThreadListItem[]>(["threads"], (old) =>
        old?.map((t) =>
          t.id === id
            ? { ...t, running }
            : t.children.some((c) => c.id === id)
              ? { ...t, children: t.children.map((c) => (c.id === id ? { ...c, running } : c)) }
              : t,
        ),
      );
    },
    [qc],
  );

  /** Keep the sidebar's nested sub-agent list in sync with task events. */
  const upsertTaskInSidebar = useCallback(
    (parentId: string, task: ClientTask) => {
      qc.setQueryData<ThreadListItem[]>(["threads"], (old) =>
        old?.map((t) => {
          if (t.id !== parentId) return t;
          const child = {
            id: task.childThreadId,
            title: task.title,
            running: task.status === "RUNNING",
            taskStatus: task.status,
          };
          const exists = t.children.some((c) => c.id === child.id);
          return {
            ...t,
            children: exists ? t.children.map((c) => (c.id === child.id ? child : c)) : [...t.children, child],
          };
        }),
      );
    },
    [qc],
  );

  /** Attach to a run's SSE stream, replaying after lastSeq; reconnects on network drops. */
  const connect = useCallback(
    async (run: ActiveRun, tId: string) => {
      streams.current.get(run.id)?.abort();
      const controller = new AbortController();
      streams.current.set(run.id, controller);
      if (!seqs.current.has(run.id)) seqs.current.set(run.id, 0);
      setActiveRuns((prev) => [...prev.filter((r) => r.id !== run.id), run]);
      markThreadRunning(tId, true);
      const lastSeq = {
        get current() {
          return seqs.current.get(run.id) ?? 0;
        },
        set current(v: number) {
          seqs.current.set(run.id, v);
        },
      };

      let finished = false;
      let attempts = 0;

      const handle = (events: RunEvent[]) => {
        let ops: PartOp[] = [];
        for (const e of events) {
          if (e.seq <= lastSeq.current && e.seq !== Number.MAX_SAFE_INTEGER) continue;
          lastSeq.current = Math.max(lastSeq.current, e.seq === Number.MAX_SAFE_INTEGER ? lastSeq.current : e.seq);
          if (e.type === "ops") {
            ops = ops.concat(e.ops);
          } else if (e.type === "title") {
            setThreadTitle(e.threadId, e.title);
          } else if (e.type === "phase") {
            if (run.primary) setPhase(e.phase);
          } else if (e.type === "steer_queue") {
            if (run.primary) setPendingSteers(e.pending);
          } else if (e.type === "task") {
            const task = e.task;
            setTasks((prev) => (prev.some((t) => t.id === task.id) ? prev.map((t) => (t.id === task.id ? task : t)) : [...prev, task]));
            upsertTaskInSidebar(tId, task);
          } else if (e.type === "done") {
            finished = true;
            if (ops.length) {
              // Flush ops batched before `done` so nothing is lost; done.parts then replaces them.
              ops = [];
            }
            if (run.primary) {
              setPhase(null);
              setPendingSteers([]);
            }
            updateMessage(run.messageId, (m) => ({
              ...m,
              parts: e.parts,
              status: e.messageStatus,
              error: e.error,
              usage: e.usage
                ? {
                    inputTokens: e.usage.inputTokens,
                    cachedInputTokens: e.usage.cachedInputTokens,
                    outputTokens: e.usage.outputTokens,
                    reasoningTokens: e.usage.reasoningTokens,
                    totalTokens: e.usage.totalTokens,
                    webSearchCalls: e.webSearchCalls,
                    costMicros: e.costMicros,
                    priced: true,
                  }
                : m.usage,
            }));
            if (e.contextUsage || e.costMicros) {
              const ctxUsage = run.primary ? e.contextUsage : null;
              setMeta((m) =>
                m
                  ? {
                      ...m,
                      lastContext: ctxUsage
                        ? { ...ctxUsage, modelId: m.lastModelId ?? "", at: new Date().toISOString() }
                        : m.lastContext,
                      spentMicros: m.spentMicros + e.costMicros,
                    }
                  : m,
              );
            }
          }
        }
        if (ops.length) {
          const batch = ops;
          updateMessage(run.messageId, (m) => ({ ...m, parts: applyPartOps(m.parts, batch) }));
        }
      };

      while (!finished && !controller.signal.aborted && attempts <= MAX_RECONNECTS) {
        try {
          const res = await fetch(`/api/runs/${run.id}/stream?after=${lastSeq.current}`, {
            signal: controller.signal,
            credentials: "same-origin",
            cache: "no-store",
          });
          if (!res.ok || !res.body) {
            if (res.status === 404 || res.status === 401) break;
            throw new Error(`stream ${res.status}`);
          }
          attempts = 0;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const { events, rest } = parseSse(buffer);
            buffer = rest;
            if (events.length) handle(events);
          }
        } catch {
          if (controller.signal.aborted) return;
        }
        if (!finished && !controller.signal.aborted) {
          attempts++;
          await new Promise((r) => setTimeout(r, Math.min(500 * attempts, 3000)));
        }
      }

      if (streams.current.get(run.id) === controller) streams.current.delete(run.id);
      seqs.current.delete(run.id);
      if (controller.signal.aborted || !mounted.current) return;
      setActiveRuns((prev) => prev.filter((r) => r.id !== run.id));
      if (streams.current.size === 0) markThreadRunning(tId, false);
      void qc.invalidateQueries({ queryKey: ["limits"] });
      void refreshMeta(tId);
      // Auto-titles can land a moment after the reply finishes; pick them up.
      setTimeout(() => {
        if (mounted.current) void refreshMeta(tId);
      }, 4000);
    },
    [markThreadRunning, qc, refreshMeta, setThreadTitle, updateMessage, upsertTaskInSidebar],
  );

  // Initial load (and reattach to a live run).
  useEffect(() => {
    if (!initialThreadId) return;
    let cancelled = false;
    (async () => {
      try {
        const { thread } = await api<{ thread: ClientThreadDetail }>(`/api/threads/${initialThreadId}`);
        if (cancelled) return;
        applyDetail(thread);
        setMessages(thread.messages);
        setLeafId(thread.currentLeafId);
        setLoading(false);
        thread.activeRuns.forEach((r, i) => {
          if (!r.messageId) return;
          seqs.current.set(r.id, 0);
          const isPrimary = r.messageId === thread.currentLeafId || (i === 0 && !thread.activeRuns.some((x) => x.messageId === thread.currentLeafId));
          void connect({ id: r.id, messageId: r.messageId, primary: isPrimary }, thread.id);
        });
      } catch {
        if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialThreadId, applyDetail, connect]);

  const startTurn = useCallback(
    (res: TurnResponse) => {
      setMeta((m) => ({
        id: res.thread.id,
        title: res.thread.title,
        webSearchEnabled: res.thread.webSearchEnabled,
        lastModelId: res.thread.lastModelId,
        lastEffort: res.thread.lastEffort,
        lastContext: m?.lastContext ?? res.thread.lastContext,
        spentMicros: m?.spentMicros ?? 0,
        kind: res.thread.kind,
        parent: m?.parent ?? null,
        task: m?.task ?? null,
        projectId: res.thread.projectId,
      }));
      seqs.current.set(res.runId, 0);
      void connect({ id: res.runId, messageId: res.assistant.id, primary: true }, res.thread.id);
      for (const c of res.compare ?? []) {
        seqs.current.set(c.runId, 0);
        void connect({ id: c.runId, messageId: c.assistant.id, primary: false }, res.thread.id);
      }
    },
    [connect],
  );

  /** Add a turn's new messages and move the visible branch to its reply. */
  const addTurnMessages = useCallback((res: TurnResponse, dropId?: string) => {
    const added = [...(res.userMessage ? [res.userMessage] : []), res.assistant, ...(res.compare ?? []).map((c) => c.assistant)];
    setMessages((prev) => [...prev.filter((m) => m.id !== dropId && !added.some((a) => a.id === m.id)), ...added]);
    setLeafId(res.assistant.id);
  }, []);

  const send = useCallback(
    async (args: { text: string; attachments: ClientAttachment[]; compare?: { modelId: string; effort: string | null } | null } & TurnSettings) => {
      setSending(true);
      const tempId = `temp_${Date.now()}`;
      const previousLeaf = leafId;
      const optimistic: ClientMessage = {
        id: tempId,
        parentId: messages.at(-1)?.id ?? null,
        compareGroupId: null,
        role: "USER",
        parts: [
          ...args.attachments.map((a): MessagePart =>
            a.kind === "IMAGE"
              ? { type: "user_image", id: `img_${a.id}`, attachmentId: a.id, mime: a.mime }
              : {
                  type: "user_file",
                  id: `file_${a.id}`,
                  attachmentId: a.id,
                  fileName: a.fileName,
                  mime: a.mime,
                  size: a.size,
                  chars: a.textChars ?? 0,
                },
          ),
          ...(args.text.trim() ? [{ type: "user_text" as const, id: `${tempId}_t`, text: args.text }] : []),
        ],
        modelId: null,
        effort: null,
        webSearch: false,
        status: "COMPLETE",
        error: null,
        createdAt: new Date().toISOString(),
        usage: null,
      };
      setMessages((prev) => [...prev, optimistic]);
      setLeafId(tempId);
      try {
        const body = {
          text: args.text,
          attachmentIds: args.attachments.map((a) => a.id),
          modelId: args.modelId,
          effort: args.effort,
          webSearch: args.webSearch,
          ...(args.compare ? { compare: args.compare } : {}),
          ...(!threadId && projectId ? { projectId } : {}),
        };
        const res = await api<TurnResponse & { userMessage: ClientMessage }>(
          threadId ? `/api/threads/${threadId}/messages` : "/api/messages",
          { method: "POST", json: body },
        );
        addTurnMessages(res, tempId);
        if (!threadId) {
          setThreadId(res.thread.id);
          window.history.replaceState(null, "", `/t/${res.thread.id}`);
          qc.setQueryData<ThreadListItem[]>(["threads"], (old) => [
            { ...res.thread, running: true, children: [], project: null },
            ...(old ?? []).filter((t) => t.id !== res.thread.id),
          ]);
          // Pick up the project label (and counts on the project page).
          if (res.thread.projectId) {
            void qc.invalidateQueries({ queryKey: ["threads"] });
            void qc.invalidateQueries({ queryKey: ["project", res.thread.projectId] });
            void qc.invalidateQueries({ queryKey: ["projects"] });
          }
        } else {
          qc.setQueryData<ThreadListItem[]>(["threads"], (old) =>
            old?.map((t) => (t.id === res.thread.id ? { ...t, ...res.thread, running: true } : t)),
          );
        }
        startTurn(res);
        return true;
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setLeafId(previousLeaf);
        throw err;
      } finally {
        setSending(false);
      }
    },
    [addTurnMessages, leafId, messages, projectId, qc, startTurn, threadId],
  );

  const edit = useCallback(
    async (messageId: string, text: string, settings: TurnSettings) => {
      const res = await api<TurnResponse & { userMessage: ClientMessage }>(`/api/messages/${messageId}/edit`, {
        method: "POST",
        json: { text, ...settings },
      });
      addTurnMessages(res);
      startTurn(res);
    },
    [addTurnMessages, startTurn],
  );

  const regenerate = useCallback(
    async (messageId: string, settings: TurnSettings) => {
      const res = await api<TurnResponse>(`/api/messages/${messageId}/regenerate`, { method: "POST", json: settings });
      addTurnMessages(res);
      startTurn(res);
    },
    [addTurnMessages, startTurn],
  );

  /**
   * Show another branch: `targetId` is a message (usually a sibling of one on the current path);
   * the view moves to the newest leaf below it. Saved on the server so reloads keep it.
   */
  const switchBranch = useCallback(
    async (targetId: string) => {
      if (!threadId) return;
      const prev = leafId;
      const next = deepestLeaf(allMessages, targetId);
      if (next === prev) return;
      setLeafId(next);
      try {
        await api(`/api/threads/${threadId}`, { method: "PATCH", json: { currentLeafId: next } });
      } catch (err) {
        setLeafId(prev);
        throw err;
      }
    },
    [allMessages, leafId, threadId],
  );

  const primaryRun = activeRuns.find((r) => r.primary) ?? activeRuns[0] ?? null;
  /** Steering and interrupt only make sense with a single run. */
  const activeRun = activeRuns.length === 1 ? primaryRun : null;

  const stop = useCallback(async () => {
    await Promise.all(activeRuns.map((r) => api(`/api/runs/${r.id}/stop`, { method: "POST" }).catch(() => undefined)));
  }, [activeRuns]);

  /**
   * Send a message into the running turn. Returns false if the run had already finished,
   * in which case the caller should send it as a normal message.
   */
  const steer = useCallback(
    async (text: string): Promise<boolean> => {
      if (!activeRun) return false;
      const res = await api<{ accepted: boolean; steer: PendingSteer | null }>(`/api/runs/${activeRun.id}/steer`, {
        method: "POST",
        json: { text },
      });
      if (res.accepted && res.steer) {
        const s = res.steer;
        setPendingSteers((prev) => (prev.some((p) => p.id === s.id) ? prev : [...prev, s]));
      }
      return res.accepted;
    },
    [activeRun],
  );

  /** Abort the current generation only (sub-agents keep running); optionally send `text` right away. */
  const interrupt = useCallback(
    async (text?: string): Promise<boolean> => {
      if (!activeRun) return false;
      const res = await api<{ interrupted: boolean; accepted: boolean }>(`/api/runs/${activeRun.id}/interrupt`, {
        method: "POST",
        json: text ? { text } : {},
      });
      return !text || res.accepted;
    },
    [activeRun],
  );

  const cancelTask = useCallback(async (taskId: string) => {
    await api(`/api/tasks/${taskId}/cancel`, { method: "POST" });
  }, []);

  const setWebSearchForThread = useCallback(
    (enabled: boolean) => {
      setMeta((m) => (m ? { ...m, webSearchEnabled: enabled } : m));
      if (threadId) void api(`/api/threads/${threadId}`, { method: "PATCH", json: { webSearchEnabled: enabled } }).catch(() => undefined);
    },
    [threadId],
  );

  return {
    threadId,
    meta,
    messages,
    allMessages,
    leafId,
    switchBranch,
    activeRun,
    activeRuns,
    running: activeRuns.length > 0,
    loading,
    notFound,
    sending,
    phase,
    pendingSteers,
    tasks,
    send,
    steer,
    interrupt,
    cancelTask,
    edit,
    regenerate,
    stop,
    setWebSearchForThread,
  };
}
