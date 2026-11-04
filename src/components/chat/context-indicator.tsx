"use client";

import { useState } from "react";
import type { ContextSnapshot } from "@/lib/parts";
import { formatTokens, formatUsd } from "@/lib/money";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { useLimits, type LimitWindow } from "@/hooks/queries";

export type ContextModelInfo = {
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  longContextThreshold: number | null;
};

/**
 * Estimated size of the next prompt: last turn's input plus the visible output that
 * will be replayed. Reasoning tokens are not replayed, so they're excluded.
 */
export function estimateNextPrompt(ctx: ContextSnapshot | null): number {
  if (!ctx) return 0;
  return ctx.inputTokens + Math.max(0, ctx.outputTokens - ctx.reasoningTokens);
}

function Ring({ pct, tone }: { pct: number; tone: string }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  const filled = Math.max(pct > 0 ? 0.04 : 0, Math.min(1, pct)) * c;
  return (
    <svg viewBox="0 0 20 20" className="size-5 -rotate-90">
      <circle cx="10" cy="10" r={r} fill="none" strokeWidth="2.5" className="stroke-muted-foreground/25" />
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${c}`}
        className={cn("transition-[stroke-dasharray] duration-500", tone)}
      />
    </svg>
  );
}

export function ContextIndicator({
  context,
  model,
  spentMicros,
}: {
  context: ContextSnapshot | null;
  model: ContextModelInfo | null;
  spentMicros: number;
}) {
  const [open, setOpen] = useState(false);
  const { data: limits } = useLimits();
  const used = estimateNextPrompt(context);
  const window = model?.contextWindow ?? null;
  const pct = window ? used / window : 0;
  const tone = pct >= 0.9 ? "stroke-red-500" : pct >= 0.75 ? "stroke-amber-500" : "stroke-foreground/80";
  const remaining = window ? Math.max(0, window - used) : null;

  const cached = context?.cachedInputTokens ?? 0;
  const uncached = Math.max(0, (context?.inputTokens ?? 0) - cached);
  const visibleOut = Math.max(0, (context?.outputTokens ?? 0) - (context?.reasoningTokens ?? 0));
  // The bar represents the whole window when known, otherwise just the used tokens.
  const denom = window ?? Math.max(1, cached + uncached + visibleOut);
  const w = (n: number) => `${Math.min(100, (n / denom) * 100)}%`;
  const overLongContext = model?.longContextThreshold != null && used > model.longContextThreshold;

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={100} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={window ? `Context ${Math.round(pct * 100)}% used` : "Context usage"}
          className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-muted"
        >
          <Ring pct={pct} tone={tone} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="end" collisionPadding={8} className="w-[min(18rem,calc(100vw-1rem))] p-0">
        <div className="space-y-3 p-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">Context window</span>
            <span className="truncate text-xs text-muted-foreground">{model?.displayName ?? "No model"}</span>
          </div>

          {!context ? (
            <p className="text-sm text-muted-foreground">Nothing in context yet. Send a message to start.</p>
          ) : (
            <>
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-semibold tabular-nums">
                    {window ? `${(pct * 100).toFixed(pct < 0.1 ? 1 : 0)}%` : formatTokens(used)}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatTokens(used)}
                    {window ? ` / ${formatTokens(window)} tokens` : " tokens"}
                  </span>
                </div>
                <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
                  <div className="bg-chart-3" style={{ width: w(cached) }} />
                  <div className="bg-chart-1" style={{ width: w(uncached) }} />
                  <div className="bg-chart-2" style={{ width: w(visibleOut) }} />
                </div>
              </div>

              <dl className="space-y-1.5 text-xs">
                <Row swatch="bg-chart-3" label="Cached input" value={formatTokens(cached)} />
                <Row swatch="bg-chart-1" label="Uncached input" value={formatTokens(uncached)} />
                <Row swatch="bg-chart-2" label="Last reply" value={formatTokens(visibleOut)} />
                <Row label="Reasoning (not carried over)" value={formatTokens(context.reasoningTokens)} muted />
                {remaining != null && <Row label="Remaining" value={formatTokens(remaining)} />}
                {model?.maxOutputTokens && <Row label="Max output per reply" value={formatTokens(model.maxOutputTokens)} />}
              </dl>

              {overLongContext && (
                <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                  Over {formatTokens(model!.longContextThreshold!)} input tokens, so long-context pricing may apply.
                </p>
              )}
            </>
          )}
        </div>
        <div className="space-y-1 border-t px-3.5 py-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Spent in this thread</span>
            <span className="font-medium tabular-nums">{formatUsd(spentMicros)}</span>
          </div>
          {limits && !limits.unlimited && (
            <>
              <BudgetRow label="Left this week" w={limits.weekly} />
              <BudgetRow label="Left this month" w={limits.monthly} />
            </>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function BudgetRow({ label, w }: { label: string; w: LimitWindow }) {
  if (w.limitMicros == null) return null;
  const left = Math.max(0, w.limitMicros - w.spentMicros);
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-medium tabular-nums",
          w.alert === "reached" && "text-destructive",
          w.alert === "warning" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {formatUsd(left)} <span className="font-normal text-muted-foreground">of {formatUsd(w.limitMicros)}</span>
      </span>
    </div>
  );
}

function Row({ swatch, label, value, muted }: { swatch?: string; label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-2", muted && "text-muted-foreground")}>
      <dt className="flex items-center gap-1.5">
        {swatch ? <span className={cn("size-2 rounded-sm", swatch)} /> : <span className="size-2" />}
        {label}
      </dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
