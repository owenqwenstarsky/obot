"use client";

import { useEffect, useState } from "react";
import { Brain, ChevronRight } from "lucide-react";
import { Streamdown } from "streamdown";
import type { ReasoningPart } from "@/lib/parts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 1) return "a moment";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function ReasoningBlock({ part, live }: { part: ReasoningPart; live: boolean }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);

  const elapsed = (part.endedAt ?? now) - part.startedAt;
  const hasSummary = part.summary.trim().length > 0;
  // Show the latest summary heading while thinking (summaries usually start with **Title**).
  const liveHeadline = live
    ? part.summary
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .reverse()
        .find((l) => /^\*\*.+\*\*$/.test(l))
        ?.replace(/\*\*/g, "")
    : undefined;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        disabled={!hasSummary}
        className="group/reason flex max-w-full items-center gap-2 rounded-md py-1 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
      >
        <Brain className="size-4 shrink-0" />
        {live ? (
          <span className="truncate">
            <span className="text-shimmer font-medium">Thinking</span>
            {liveHeadline && <span className="ml-1.5 text-muted-foreground/80">· {liveHeadline}</span>}
          </span>
        ) : (
          <span>Thought for {formatDuration(elapsed)}</span>
        )}
        {hasSummary && (
          <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden">
        <div className="mt-1 ml-2 border-l-2 border-border pl-4 text-sm text-muted-foreground [&_p]:my-1.5">
          <Streamdown mode={live ? "streaming" : "static"} controls={false} linkSafety={{ enabled: false }}>
            {part.summary}
          </Streamdown>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
