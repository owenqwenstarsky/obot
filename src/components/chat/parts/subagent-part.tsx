"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Bot, CircleAlert, CircleCheck, Clock, Hourglass, ListChecks, Loader2, Square, Users } from "lucide-react";
import { toast } from "sonner";
import type { FunctionToolPart, SubagentTaskStatusValue } from "@/lib/parts";
import { partialJsonString } from "@/lib/partial-json";
import { errorMessage } from "@/lib/api";
import { useModels } from "@/hooks/queries";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useChatTasks } from "../tasks-context";
import { useMessageView } from "../view-context";
import { isToolLive } from "./function-tool-part";

const STATUS: Record<SubagentTaskStatusValue, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  RUNNING: { label: "Running", className: "bg-primary/10 text-primary", icon: Loader2 },
  COMPLETED: { label: "Done", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", icon: CircleCheck },
  FAILED: { label: "Failed", className: "bg-destructive/10 text-destructive", icon: CircleAlert },
  CANCELLED: { label: "Cancelled", className: "bg-muted text-muted-foreground", icon: Ban },
  INTERRUPTED: { label: "Interrupted", className: "bg-muted text-muted-foreground", icon: Ban },
};

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function elapsed(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Live card for one delegated sub-agent task. */
export function DelegateCard({ part }: { part: FunctionToolPart }) {
  const tasksApi = useChatTasks();
  const { readOnly } = useMessageView();
  const { data: modelsData } = useModels(!readOnly);
  const display = part.display?.kind === "subagent" ? part.display : null;
  const task = display ? tasksApi?.tasks.get(display.taskId) : undefined;
  const status: SubagentTaskStatusValue | null = task?.status ?? display?.status ?? null;
  const running = status === "RUNNING";
  const now = useNow(running);
  const [cancelling, setCancelling] = useState(false);

  const title = display?.title ?? partialJsonString(part.argsText, "title") ?? "Sub-agent";
  const modelId = display?.modelId ?? task?.modelId ?? partialJsonString(part.argsText, "model");
  const modelName = modelId ? (modelsData?.models.find((m) => m.id === modelId)?.displayName ?? modelId) : null;
  const starting = !display && isToolLive(part);
  const failedToStart = !display && (part.status === "failed" || part.status === "cancelled");
  const started = task ? new Date(task.createdAt).getTime() : part.startedAt;
  const ended = task?.endedAt ? new Date(task.endedAt).getTime() : null;
  const s = status ? STATUS[status] : null;

  return (
    <div className="flex w-full max-w-md items-center gap-3 rounded-xl border bg-card px-3 py-2.5 shadow-xs">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60">
        {starting ? <Loader2 className="size-4 animate-spin text-primary" /> : <Bot className="size-4 text-muted-foreground" />}
      </span>
      <div className="min-w-0 flex-1">
        {display && !readOnly ? (
          <Link href={`/t/${display.childThreadId}`} className="block truncate text-sm font-medium hover:underline">
            {title}
          </Link>
        ) : (
          <span className="block truncate text-sm font-medium">{title}</span>
        )}
        <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          {starting ? (
            <span className="text-shimmer">Starting sub-agent…</span>
          ) : failedToStart ? (
            <span className="truncate text-destructive">{part.error?.replace(/^Error:\s*/, "") ?? "Couldn't start"}</span>
          ) : (
            <>
              {modelName && <span className="truncate">{modelName}</span>}
              {display && (
                <>
                  <span aria-hidden>·</span>
                  <Clock className="size-3 shrink-0" />
                  <span className="tabular-nums">{elapsed((ended ?? (running ? now : started)) - started)}</span>
                </>
              )}
            </>
          )}
        </span>
      </div>
      {s && (
        <span className={cn("flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", s.className)}>
          <s.icon className={cn("size-3", running && "animate-spin")} />
          {s.label}
        </span>
      )}
      {display && running && tasksApi && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={cancelling}
              onClick={async () => {
                setCancelling(true);
                try {
                  await tasksApi.cancel(display.taskId);
                } catch (err) {
                  toast.error(errorMessage(err));
                } finally {
                  setCancelling(false);
                }
              }}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              aria-label="Cancel sub-agent"
            >
              <Square className="size-3 fill-current" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Cancel this sub-agent</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

const MINI: Record<string, { icon: React.ComponentType<{ className?: string }>; live: string; done: string }> = {
  subagent_capabilities: { icon: Users, live: "Checking sub-agent options", done: "Checked sub-agent options" },
  wait_tasks: { icon: Hourglass, live: "Waiting for sub-agents", done: "Waited for sub-agents" },
  task_status: { icon: ListChecks, live: "Checking sub-agents", done: "Checked sub-agents" },
  task_cancel: { icon: Ban, live: "Cancelling a sub-agent", done: "Cancelled a sub-agent" },
};

/** One-line rendering for the orchestration helper tools. */
export function SubagentMiniLine({ part }: { part: FunctionToolPart }) {
  const m = MINI[part.name];
  const live = isToolLive(part);
  const Icon = live ? Loader2 : m.icon;
  return (
    <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
      <Icon className={cn("size-3.5", live && "animate-spin text-primary")} />
      <span className={cn(live && "text-shimmer", part.status === "failed" && "text-destructive")}>
        {part.status === "failed" ? `${m.done} (failed)` : live ? m.live : m.done}
      </span>
    </div>
  );
}
