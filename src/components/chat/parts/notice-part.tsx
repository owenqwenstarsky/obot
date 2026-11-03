"use client";

import Link from "next/link";
import { useMessageView } from "../view-context";
import { Ban, CircleAlert, CircleCheck, Gauge, Hourglass, Loader2, Zap } from "lucide-react";
import type { NoticePart, WaitingPart } from "@/lib/parts";
import { cn } from "@/lib/utils";

const NOTICE: Record<NoticePart["kind"], { icon: React.ComponentType<{ className?: string }>; tone: string; label: (p: NoticePart) => string }> = {
  task_finished: { icon: CircleCheck, tone: "text-emerald-600 dark:text-emerald-400", label: (p) => `${p.title ?? "Sub-agent"} finished` },
  task_failed: { icon: CircleAlert, tone: "text-destructive", label: (p) => `${p.title ?? "Sub-agent"} failed` },
  task_cancelled: { icon: Ban, tone: "text-muted-foreground", label: (p) => `${p.title ?? "Sub-agent"} was cancelled` },
  interrupted: { icon: Zap, tone: "text-amber-600 dark:text-amber-400", label: () => "Interrupted" },
  limit_reached: { icon: Gauge, tone: "text-destructive", label: () => "Spend limit reached" },
  max_steps: { icon: Hourglass, tone: "text-muted-foreground", label: (p) => p.message ?? "Step limit reached" },
};

/** A slim inline divider for runtime events. */
export function NoticeLine({ part }: { part: NoticePart }) {
  const n = NOTICE[part.kind];
  const Icon = n.icon;
  const label = n.label(part);
  const { readOnly } = useMessageView();
  return (
    <div className="flex items-center gap-3 py-0.5 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon className={cn("size-3.5 shrink-0", n.tone)} />
        {part.childThreadId && !readOnly ? (
          <Link href={`/t/${part.childThreadId}`} className="truncate hover:text-foreground hover:underline">
            {label}
          </Link>
        ) : (
          <span className="truncate">{label}</span>
        )}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function WaitingLine({ part, live }: { part: WaitingPart; live: boolean }) {
  if (!live || part.endedAt != null) return null;
  const n = part.taskIds.length;
  return (
    <div className="flex items-center gap-2 py-0.5 text-sm text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin text-primary" />
      <span className="text-shimmer">
        Waiting on {n} sub-agent{n === 1 ? "" : "s"}…
      </span>
    </div>
  );
}
