"use client";

import type {
  ErrorPart,
  FunctionToolPart,
  GenericToolPart,
  MessagePart,
  NoticePart,
  ReasoningPart,
  SteerPart,
  TextPart,
  WaitingPart,
  WebSearchPart,
} from "@/lib/parts";
import { ReasoningBlock } from "./reasoning-part";
import { WebSearchGroup } from "./web-search-part";
import { TextBlock } from "./text-part";
import { GenericToolBlock } from "./generic-tool-part";
import { ErrorBlock } from "./error-part";
import { FunctionToolBlock } from "./function-tool-part";
import { SteerBubble } from "./steer-part";
import { NoticeLine, WaitingLine } from "./notice-part";

export type Segment =
  | { kind: "text"; key: string; part: TextPart }
  | { kind: "reasoning"; key: string; part: ReasoningPart }
  | { kind: "web_search"; key: string; parts: WebSearchPart[] }
  | { kind: "generic_tool"; key: string; part: GenericToolPart }
  | { kind: "function"; key: string; part: FunctionToolPart }
  | { kind: "steer"; key: string; part: SteerPart }
  | { kind: "notice"; key: string; part: NoticePart }
  | { kind: "waiting"; key: string; part: WaitingPart }
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
    } else if (p.type === "tool" && p.tool === "function") {
      out.push({ kind: "function", key: p.id, part: p });
    } else if (p.type === "tool") {
      out.push({ kind: "generic_tool", key: p.id, part: p });
    } else if (p.type === "steer") {
      out.push({ kind: "steer", key: p.id, part: p });
    } else if (p.type === "notice") {
      out.push({ kind: "notice", key: p.id, part: p });
    } else if (p.type === "waiting") {
      out.push({ kind: "waiting", key: p.id, part: p });
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
          case "function":
            return <FunctionToolBlock key={s.key} part={s.part} />;
          case "steer":
            return <SteerBubble key={s.key} part={s.part} />;
          case "notice":
            return <NoticeLine key={s.key} part={s.part} />;
          case "waiting":
            return <WaitingLine key={s.key} part={s.part} live={streaming} />;
          case "error":
            return <ErrorBlock key={s.key} part={s.part} />;
        }
      })}
    </div>
  );
}
