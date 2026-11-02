"use client";

import { useMemo, useState } from "react";
import { ChevronRight, FileText, Globe, Loader2, ScanSearch, Search, TriangleAlert } from "lucide-react";
import type { WebSearchAction, WebSearchPart } from "@/lib/parts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { Favicon, domainOf } from "./favicon";

function shortUrl(url?: string) {
  if (!url) return "a page";
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    const s = `${u.hostname.replace(/^www\./, "")}${path}`;
    return s.length > 60 ? `${s.slice(0, 57)}…` : s;
  } catch {
    return url;
  }
}

function plural(n: number, singular: string, pluralForm = `${singular}s`) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function WebSearchGroup({ parts }: { parts: WebSearchPart[] }) {
  const [open, setOpen] = useState(false);
  const live = parts.some((p) => p.status === "in_progress" || p.status === "searching");
  const failed = parts.every((p) => p.status === "failed");

  const { actions, sources, queries, opened } = useMemo(() => {
    const actions: WebSearchAction[] = parts.flatMap((p) => p.actions);
    const seen = new Set<string>();
    const sources: { url: string; title?: string }[] = [];
    for (const p of parts)
      for (const s of p.sources) {
        if (seen.has(s.url)) continue;
        seen.add(s.url);
        sources.push(s);
      }
    const queries = actions.flatMap((a) => (a.kind === "search" ? a.queries : []));
    const opened = actions.filter((a) => a.kind === "open_page").length;
    return { actions, sources, queries, opened };
  }, [parts]);

  const latestQuery = queries[queries.length - 1];
  const latestAction = actions[actions.length - 1];

  let label: React.ReactNode;
  if (live) {
    const what =
      latestAction?.kind === "open_page"
        ? `Reading ${shortUrl(latestAction.url)}`
        : latestAction?.kind === "find_in_page"
          ? `Looking for “${latestAction.pattern ?? "…"}”`
          : latestQuery
            ? `Searching for “${latestQuery}”`
            : "Searching the web";
    label = <span className="text-shimmer truncate font-medium">{what}</span>;
  } else if (failed) {
    label = <span>Web search failed</span>;
  } else {
    const bits = [];
    if (queries.length) bits.push(`Searched ${plural(queries.length, "query", "queries")}`);
    else bits.push("Searched the web");
    if (opened) bits.push(`read ${plural(opened, "page")}`);
    if (sources.length) bits.push(plural(sources.length, "source"));
    label = <span className="truncate">{bits.join(" · ")}</span>;
  }

  const hasDetails = actions.length > 0 || sources.length > 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border bg-card/60">
      <CollapsibleTrigger
        disabled={!hasDetails}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default"
      >
        {live ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
        ) : failed ? (
          <TriangleAlert className="size-4 shrink-0 text-destructive" />
        ) : (
          <Globe className="size-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {!open && sources.length > 0 && (
          <span className="flex shrink-0 -space-x-1">
            {sources.slice(0, 5).map((s) => (
              <span key={s.url} className="flex size-5 items-center justify-center rounded-full border bg-background">
                <Favicon url={s.url} className="size-3" />
              </span>
            ))}
          </span>
        )}
        {hasDetails && <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />}
      </CollapsibleTrigger>

      <CollapsibleContent className="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden">
        <div className="space-y-3 border-t px-3 py-3">
          {actions.length > 0 && (
            <ol className="space-y-2">
              {actions.map((a, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  {a.kind === "search" && (
                    <>
                      <Search className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <div className="flex flex-wrap gap-1.5">
                        {(a.queries.length ? a.queries : ["(query not reported)"]).map((q, j) => (
                          <span key={j} className="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground/90">
                            {q}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                  {a.kind === "open_page" && (
                    <>
                      <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        Opened{" "}
                        {a.url ? (
                          <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-foreground/90 hover:underline">
                            {shortUrl(a.url)}
                          </a>
                        ) : (
                          "a page"
                        )}
                      </span>
                    </>
                  )}
                  {a.kind === "find_in_page" && (
                    <>
                      <ScanSearch className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        Looked for <span className="text-foreground/90">“{a.pattern ?? "…"}”</span>
                        {a.url && <> in {shortUrl(a.url)}</>}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
          {sources.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Sources</div>
              <ul className="grid gap-1 sm:grid-cols-2">
                {sources.map((s) => (
                  <li key={s.url}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                      title={s.url}
                    >
                      <Favicon url={s.url} />
                      <span className="min-w-0 flex-1 truncate">{s.title || domainOf(s.url)}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{domainOf(s.url)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
