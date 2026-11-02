"use client";

import { useState } from "react";
import { Brain, Check, ChevronDown, Eye, Globe, Sparkles } from "lucide-react";
import type { CatalogModel } from "@/server/llm/catalog";
import { EFFORT_LABELS, effortLabel, type AllowedEffort } from "@/lib/efforts";
import { formatTokens } from "@/lib/money";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function ModelSelector({
  models,
  modelId,
  effort,
  onChange,
  disabled,
}: {
  models: CatalogModel[];
  modelId: string | null;
  effort: string | null;
  onChange: (modelId: string, effort: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = models.find((m) => m.id === modelId) ?? null;

  function pickModel(m: CatalogModel) {
    const nextEffort =
      effort && (m.efforts as string[]).includes(effort) ? effort : (m.defaultEffort ?? null);
    onChange(m.id, m.supportsReasoning ? nextEffort : null);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled || models.length === 0}
        className="flex h-8 max-w-[16rem] min-w-0 shrink items-center gap-1.5 rounded-lg px-2 sm:px-2.5 text-sm font-medium text-foreground/90 transition-colors hover:bg-muted disabled:opacity-50 data-[state=open]:bg-muted"
      >
        <Sparkles className="size-3.5 shrink-0 text-primary" />
        <span className="truncate">{selected?.displayName ?? (models.length ? "Select model" : "No models")}</span>
        {selected?.supportsReasoning && effort && (
          <span className="hidden shrink-0 rounded bg-muted px-1.5 py-px text-[11px] font-normal text-muted-foreground sm:inline">
            {effortLabel(effort)}
          </span>
        )}
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" side="top" sideOffset={8} collisionPadding={8} className="w-[min(22rem,calc(100vw-1rem))] p-0">
        <div className="scrollbar-thin max-h-[22rem] overflow-y-auto p-1.5">
          {models.map((m) => {
            const active = m.id === modelId;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => pickModel(m)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted",
                  active && "bg-muted",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{m.displayName}</span>
                    {!m.hasPrice && (
                      <span className="rounded bg-amber-500/15 px-1 text-[10px] text-amber-600 dark:text-amber-400">unpriced</span>
                    )}
                  </div>
                  {m.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{m.description}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {m.supportsImageInput && <Feature icon={<Eye />} label="Vision" />}
                    {m.supportsWebSearch && <Feature icon={<Globe />} label="Web search" />}
                    {m.supportsReasoning && <Feature icon={<Brain />} label="Reasoning" />}
                    {m.contextWindow && (
                      <span className="rounded bg-background px-1.5 py-px text-[10px] text-muted-foreground ring-1 ring-border">
                        {formatTokens(m.contextWindow)} context
                      </span>
                    )}
                  </div>
                </div>
                {active && <Check className="mt-0.5 size-4 shrink-0 text-primary" />}
              </button>
            );
          })}
          {models.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No models are enabled yet. An admin can enable models in Admin → Models.
            </p>
          )}
        </div>
        {selected?.supportsReasoning && selected.efforts.length > 0 && (
          <div className="border-t p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Brain className="size-3.5" /> Reasoning effort
            </div>
            <div className="flex rounded-lg bg-muted p-0.5">
              {selected.efforts.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => onChange(selected.id, e)}
                  className={cn(
                    "flex-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                    effort === e && "bg-background text-foreground shadow-sm",
                  )}
                >
                  {EFFORT_LABELS[e as AllowedEffort]}
                </button>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Feature({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex size-5 items-center justify-center rounded bg-background text-muted-foreground ring-1 ring-border [&_svg]:size-3">
          {icon}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
