"use client";

import type { ErrorPart, GenericToolPart, MessagePart, ReasoningPart, TextPart, WebSearchPart } from "@/lib/parts";
import { ReasoningBlock } from "./reasoning-part";
import { WebSearchGroup } from "./web-search-part";
import { TextBlock } from "./text-part";
import { GenericToolBlock } from "./generic-tool-part";
import { ErrorBlock } from "./error-part";

export type Segment =
  | { kind: "text"; key: string; part: TextPart }
  | { kind: "reasoning"; key: string; part: ReasoningPart }
  | { kind: "web_search"; key: string; parts: WebSearchPart[] }
  | { kind: "generic_tool"; key: string; part: GenericToolPart }
  | { kind: "error"; key: string; part: ErrorPart };

/** Groups consecutive web searches into one card so a burst of searches reads as one step. */
export function groupParts(parts: MessagePart[]): Segment[] {
  const out: Segment[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (p.type === "tool" && p.tool === "web_search") {
      const last = out[out.length - 1];
      if (last?.kind === "web_search") last.parts.push(p);
      else out.push({ kind: "web_search", key: p.id, parts: [p] });
    } else if (p.type === "tool") {
      out.push({ kind: "generic_tool", key: p.id, part: p });
    } else if (p.type === "text") {
      out.push({ kind: "text", key: p.id, part: p });
    } else if (p.type === "reasoning") {
      out.push({ kind: "reasoning", key: p.id, part: p });
    } else if (p.type === "error") {
      out.push({ kind: "error", key: p.id, part: p });
    }
  }
  return out;
}

export function PartsRenderer({ parts, streaming }: { parts: MessagePart[]; streaming: boolean }) {
  const segments = groupParts(parts);
  return (
    <div className="flex flex-col gap-3">
      {segments.map((s, i) => {
        const isLast = i === segments.length - 1;
        switch (s.kind) {
          case "reasoning":
            return <ReasoningBlock key={s.key} part={s.part} live={streaming && s.part.endedAt == null} />;
          case "web_search":
            return <WebSearchGroup key={s.key} parts={s.parts} />;
          case "text":
            return <TextBlock key={s.key} part={s.part} streaming={streaming && isLast} />;
          case "generic_tool":
            return <GenericToolBlock key={s.key} part={s.part} />;
          case "error":
            return <ErrorBlock key={s.key} part={s.part} />;
        }
      })}
    </div>
  );
}
