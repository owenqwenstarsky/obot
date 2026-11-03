"use client";

import type { SteerPart } from "@/lib/parts";

/** A message the user sent while the agent was working. Splits the reply visually. */
export function SteerBubble({ part }: { part: SteerPart }) {
  return (
    <div className="my-1 flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-secondary px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words text-secondary-foreground">
        {part.text}
      </div>
    </div>
  );
}
