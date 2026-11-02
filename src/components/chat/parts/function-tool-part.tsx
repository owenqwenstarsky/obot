"use client";

import { useState } from "react";
import { ChevronRight, Loader2, Wrench } from "lucide-react";
import type { FunctionToolPart } from "@/lib/parts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { toolRenderers } from "./tool-renderers";

export function isToolLive(part: FunctionToolPart) {
  return part.status === "streaming_args" || part.status === "pending" || part.status === "running";
}

export function humanizeTool(name: string) {
  return name.replace(/_/g, " ");
}

/** Dispatches a function tool part to its dedicated renderer, or a generic card. */
export function FunctionToolBlock({ part }: { part: FunctionToolPart }) {
  const Renderer = toolRenderers[part.name];
  if (Renderer) return <Renderer part={part} />;
  return <GenericFunctionBlock part={part} />;
}

function GenericFunctionBlock({ part }: { part: FunctionToolPart }) {
  const [open, setOpen] = useState(false);
  const live = isToolLive(part);
  const failed = part.status === "failed";
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border bg-card/60">
      <CollapsibleTrigger className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground">
        {live ? <Loader2 className="size-4 animate-spin text-primary" /> : <Wrench className="size-4" />}
        <span className={cn("flex-1 capitalize", live && "text-shimmer", failed && "text-destructive")}>
          {live ? `Using ${humanizeTool(part.name)}` : failed ? `${humanizeTool(part.name)} failed` : `Used ${humanizeTool(part.name)}`}
        </span>
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="scrollbar-thin max-h-72 overflow-auto border-t px-3 py-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
          {prettyArgs(part.argsText)}
          {part.error ? `\n\n${part.error}` : ""}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function prettyArgs(argsText: string) {
  try {
    return JSON.stringify(JSON.parse(argsText), null, 2);
  } catch {
    return argsText;
  }
}
