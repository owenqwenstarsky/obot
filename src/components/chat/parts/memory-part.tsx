"use client";

import Link from "next/link";
import { Brain, Loader2 } from "lucide-react";
import type { FunctionToolPart } from "@/lib/parts";
import { partialJsonString } from "@/lib/partial-json";
import { cn } from "@/lib/utils";
import { isToolLive } from "./function-tool-part";
import { useMessageView } from "../view-context";

/** One-line card for `remember` / `forget`. */
export function MemoryBlock({ part }: { part: FunctionToolPart }) {
  const live = isToolLive(part);
  const { readOnly } = useMessageView();
  const display = part.display?.kind === "memory" ? part.display : null;
  const forgetting = part.name === "forget";
  const content = display?.content ?? (forgetting ? null : partialJsonString(part.argsText, "content"));
  const failed = part.status === "failed";
  const verb = live
    ? forgetting
      ? "Forgetting"
      : "Saving to memory"
    : failed
      ? forgetting
        ? "Couldn't forget"
        : "Couldn't save to memory"
      : forgetting
        ? "Forgot"
        : "Saved to memory";
  return (
    <div className="flex items-center gap-2.5 rounded-xl border bg-card/60 px-3 py-2 text-sm text-muted-foreground">
      {live ? <Loader2 className="size-4 shrink-0 animate-spin text-primary" /> : <Brain className="size-4 shrink-0" />}
      <span className={cn("min-w-0 flex-1 truncate", live && "text-shimmer")} title={content ?? undefined}>
        {verb}
        {content && <span className="text-foreground/85">: {content}</span>}
        {failed && part.error && <span className="text-destructive/90"> ({part.error.replace(/^Error:\s*/, "")})</span>}
      </span>
      {!readOnly && !live && !failed && (
        <Link href="/memories" className="shrink-0 text-xs hover:text-foreground hover:underline">
          Manage
        </Link>
      )}
    </div>
  );
}
