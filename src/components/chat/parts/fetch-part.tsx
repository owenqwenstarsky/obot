"use client";

import { useState } from "react";
import { ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import type { FunctionToolPart } from "@/lib/parts";
import { partialJsonString } from "@/lib/partial-json";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { isToolLive } from "./function-tool-part";
import { domainOf, Favicon } from "./favicon";

function formatChars(n: number) {
  if (n < 1000) return `${n} chars`;
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k chars`;
}

/** One-line card for `fetch_url`: favicon, page title or host, size; errors expand. */
export function FetchUrlBlock({ part }: { part: FunctionToolPart }) {
  const [open, setOpen] = useState(false);
  const live = isToolLive(part);
  const display = part.display?.kind === "fetch" ? part.display : null;
  const url = display?.finalUrl ?? partialJsonString(part.argsText, "url") ?? "";
  const failed = part.status === "failed";
  const label = display?.title || domainOf(url) || "a page";

  const row = (
    <>
      {live ? <Loader2 className="size-4 shrink-0 animate-spin text-primary" /> : <Favicon url={url} className="size-4" />}
      <span className={cn("min-w-0 flex-1 truncate", live && "text-shimmer")}>
        {live ? "Reading " : failed ? "Couldn't read " : part.status === "cancelled" ? "Stopped reading " : "Read "}
        <span className="text-foreground/85">{label}</span>
        {display?.title && <span className="ml-1.5 text-xs text-muted-foreground">{domainOf(url)}</span>}
      </span>
      {display && (
        <span className="shrink-0 text-xs">
          {formatChars(display.chars)}
          {display.truncated ? " · truncated" : ""}
        </span>
      )}
    </>
  );

  if (failed && part.error) {
    return (
      <Collapsible open={open} onOpenChange={setOpen} className="overflow-hidden rounded-xl border bg-card/60">
        <CollapsibleTrigger className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground">
          {row}
          <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t bg-muted/40 px-3 py-2 text-xs text-destructive/90">
            <p className="break-all text-muted-foreground">{url}</p>
            <p className="mt-1 whitespace-pre-wrap">{part.error.replace(/^Error:\s*/, "")}</p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div className="flex items-center gap-2.5 rounded-xl border bg-card/60 px-3 py-2 text-sm text-muted-foreground">
      {row}
      {url && !live && /^https?:\/\//i.test(url) && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground"
          aria-label="Open page"
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  );
}
