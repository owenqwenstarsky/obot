"use client";

import { Globe } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function WebSearchToggle({
  enabled,
  supported,
  onChange,
}: {
  enabled: boolean;
  supported: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const on = enabled && supported;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={on}
          aria-label="Web search"
          disabled={!supported}
          onClick={() => onChange(!enabled)}
          className={cn(
            "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2 text-sm sm:px-2.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            on
              ? "border-primary/40 bg-primary/15 text-primary hover:bg-primary/20"
              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Globe className="size-3.5" />
          <span className="hidden sm:inline">Search</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {!supported ? "This model doesn't support web search" : on ? "Web search is on" : "Let the agent search the web"}
      </TooltipContent>
    </Tooltip>
  );
}
