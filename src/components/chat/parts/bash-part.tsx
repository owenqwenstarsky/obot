"use client";

import { useMemo, useState } from "react";
import { ChevronRight, FilePen, Loader2, SquareTerminal } from "lucide-react";
import type { FunctionToolPart } from "@/lib/parts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { isToolLive } from "./function-tool-part";
import { partialJsonString } from "@/lib/partial-json";

function firstLine(s: string, max = 80) {
  const line = s.trim().split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Terminal-style card for the sandbox `bash` tool. */
export function BashBlock({ part }: { part: FunctionToolPart }) {
  const [open, setOpen] = useState(false);
  const live = isToolLive(part);
  const display = part.display?.kind === "bash" ? part.display : null;
  const command = useMemo(() => display?.command ?? partialJsonString(part.argsText, "command") ?? "", [display, part.argsText]);
  const exit = display?.exitCode;
  const failed = part.status === "failed" || (exit != null && exit !== 0);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="overflow-hidden rounded-xl border bg-card/60">
      <CollapsibleTrigger className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground">
        {live ? <Loader2 className="size-4 shrink-0 animate-spin text-primary" /> : <SquareTerminal className="size-4 shrink-0" />}
        <span className={cn("min-w-0 flex-1 truncate font-mono text-[13px]", live && "text-shimmer")}>
          {command ? firstLine(command) : live ? "Running a command…" : "Ran a command"}
        </span>
        {exit != null && (
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px]",
              failed ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
            )}
          >
            exit {exit}
          </span>
        )}
        {part.status === "cancelled" && <span className="shrink-0 text-xs">cancelled</span>}
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="scrollbar-thin max-h-96 overflow-auto border-t bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed">
          <pre className="whitespace-pre-wrap text-foreground/90">
            <span className="text-primary select-none">$ </span>
            {command}
          </pre>
          {display?.stdout && <pre className="mt-2 whitespace-pre-wrap text-muted-foreground">{display.stdout}</pre>}
          {display?.stderr && <pre className="mt-2 whitespace-pre-wrap text-destructive/90">{display.stderr}</pre>}
          {!display && part.error && <pre className="mt-2 whitespace-pre-wrap text-destructive/90">{part.error}</pre>}
          {display?.truncated && <p className="mt-2 text-[11px] text-muted-foreground">Output was truncated for the model.</p>}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function WriteFileBlock({ part }: { part: FunctionToolPart }) {
  const live = isToolLive(part);
  const display = part.display?.kind === "write_file" ? part.display : null;
  const filePath = display?.path ?? partialJsonString(part.argsText, "path") ?? "";
  return (
    <div className="flex items-center gap-2.5 rounded-xl border bg-card/60 px-3 py-2 text-sm text-muted-foreground">
      {live ? <Loader2 className="size-4 shrink-0 animate-spin text-primary" /> : <FilePen className="size-4 shrink-0" />}
      <span className={cn("min-w-0 flex-1 truncate", live && "text-shimmer")}>
        {live ? "Writing " : part.status === "failed" ? "Couldn't write " : "Wrote "}
        <span className="font-mono text-[13px] text-foreground/80">{filePath || "a file"}</span>
      </span>
      {display && <span className="shrink-0 text-xs">{formatBytes(display.bytes)}</span>}
    </div>
  );
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
