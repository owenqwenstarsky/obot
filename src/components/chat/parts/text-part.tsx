"use client";

import { memo, useMemo, type ReactNode } from "react";
import { Streamdown, type Components } from "streamdown";
import { code } from "@streamdown/code";
import type { TextPart } from "@/lib/parts";
import { canonicalUrl, injectCitationLinks, stripCitationMarkers, stripCitationParens, uniqueSources } from "@/lib/citations";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Favicon, domainOf } from "./favicon";
import { InlineUiRenderer } from "../inline-ui/inline-ui";

const plugins = { code, renderers: [{ language: "ui", component: InlineUiRenderer }] };

function CitationChip({ href, title, index }: { href: string; title?: string; index: number }) {
  return (
    <HoverCard openDelay={150} closeDelay={50}>
      <HoverCardTrigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-full border bg-muted/70 px-1.5 py-px align-middle text-[11px] font-medium text-muted-foreground no-underline transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <Favicon url={href} className="size-3" />
          <span className="max-w-[10rem] truncate">{domainOf(href)}</span>
          <span className="text-muted-foreground/70">{index}</span>
        </a>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-72 p-3">
        <div className="flex items-start gap-2">
          <Favicon url={href} className="mt-0.5 size-4" />
          <div className="min-w-0">
            <div className="line-clamp-2 text-sm font-medium">{title || domainOf(href)}</div>
            <div className="truncate text-xs text-muted-foreground">{href}</div>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function TextBlockImpl({ part, streaming }: { part: TextPart; streaming: boolean }) {
  const sources = useMemo(() => uniqueSources(part.citations), [part.citations]);
  const markdown = useMemo(
    () => stripCitationMarkers(stripCitationParens(injectCitationLinks(part.text, part.citations), part.citations)),
    [part.text, part.citations],
  );

  const components = useMemo<Components>(() => {
    const index = new Map(sources.map((s, i) => [canonicalUrl(s.url), { ...s, n: i + 1 }]));
    return {
      a: ({ href, children }: { href?: string; children?: ReactNode }) => {
        const cited = href ? index.get(canonicalUrl(href)) : undefined;
        if (cited && href) return <CitationChip href={href} title={cited.title} index={cited.n} />;
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
            {children}
          </a>
        );
      },
    } as Components;
  }, [sources]);

  return (
    <div>
      <div className="prose-obot">
        <Streamdown
          mode={streaming ? "streaming" : "static"}
          isAnimating={streaming}
          plugins={plugins}
          components={components}
          linkSafety={{ enabled: false }}
          shikiTheme={["github-light", "github-dark"]}
        >
          {markdown}
        </Streamdown>
      </div>
      {!streaming && sources.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Sources</span>
          {sources.map((s, i) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              title={s.title || s.url}
              className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <span className="text-muted-foreground/70">{i + 1}</span>
              <Favicon url={s.url} className="size-3" />
              <span className="truncate">{s.title || domainOf(s.url)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export const TextBlock = memo(TextBlockImpl);
