"use client";

import { useState } from "react";
import { ChevronRight, Wrench } from "lucide-react";
import type { GenericToolPart } from "@/lib/parts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

function humanize(type: string) {
  return type.replace(/_call$/, "").replace(/_/g, " ");
}

/** Fallback renderer for tool types without a dedicated UI yet. */
export function GenericToolBlock({ part }: { part: GenericToolPart }) {
  const [open, setOpen] = useState(false);
  const running = part.status === "in_progress";
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border bg-card/60">
      <CollapsibleTrigger className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground">
        <Wrench className="size-4" />
        <span className={cn("flex-1 capitalize", running && "text-shimmer")}>
          {running ? `Using ${humanize(part.itemType)}` : `Used ${humanize(part.itemType)}`}
        </span>
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="scrollbar-thin max-h-72 overflow-auto border-t px-3 py-2 font-mono text-xs text-muted-foreground">
          {JSON.stringify(part.raw, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
