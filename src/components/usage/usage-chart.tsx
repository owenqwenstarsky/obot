"use client";

import { useMemo } from "react";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { UsageReport } from "./types";
import { assignSeries } from "@/lib/series-colors";
import { daysBetween } from "@/lib/date-ranges";
import { formatTokens, formatUsd } from "@/lib/money";

export type ChartMetric = "cost" | "tokens" | "requests";

const axisUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 3 });

function formatAxis(metric: ChartMetric, v: number) {
  if (metric === "cost") return v === 0 ? "$0" : axisUsd.format(v / 1_000_000);
  return formatValue(metric, v);
}

function formatValue(metric: ChartMetric, v: number) {
  if (metric === "cost") return formatUsd(v);
  if (metric === "tokens") return formatTokens(v);
  return v.toLocaleString();
}

function dayLabel(key: string, long = false) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, long ? { weekday: "short", month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });
}

export function UsageChart({
  report,
  from,
  to,
  metric,
  modelNames,
}: {
  report: UsageReport;
  from: Date | null;
  to: Date | null;
  metric: ChartMetric;
  modelNames: Map<string, string>;
}) {
  const { data, series } = useMemo(() => {
    const series = assignSeries(report.byDay.map((r) => r.modelId));
    const slotOf = new Map<string, string>();
    for (const s of series) for (const m of s.members) slotOf.set(m, s.key);

    let days: string[];
    if (from && to) days = daysBetween(from, to);
    else {
      const present = [...new Set(report.byDay.map((r) => r.day))].sort();
      if (present.length === 0) days = [];
      else {
        const [fy, fm, fd] = present[0].split("-").map(Number);
        const [ly, lm, ld] = present[present.length - 1].split("-").map(Number);
        days = daysBetween(new Date(fy, fm - 1, fd), new Date(ly, lm - 1, ld + 1), 2000);
      }
    }
    const rows = new Map<string, Record<string, number | string>>(days.map((d) => [d, { day: d }]));
    for (const r of report.byDay) {
      const row = rows.get(r.day) ?? { day: r.day };
      const key = slotOf.get(r.modelId) ?? r.modelId;
      const value = metric === "cost" ? r.costMicros : metric === "tokens" ? r.tokens : r.requests;
      row[key] = ((row[key] as number) ?? 0) + value;
      rows.set(r.day, row);
    }
    return { data: [...rows.values()].sort((a, b) => String(a.day).localeCompare(String(b.day))), series };
  }, [report, from, to, metric]);

  const label = (key: string, s?: { key: string; label: string; members: string[] }) =>
    s && s.key === "__other" ? `Other (${s.members.length})` : (modelNames.get(key) ?? key);

  if (data.length === 0) {
    return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">No usage in this range.</div>;
  }

  const TooltipBody = ({ active, payload, label: day }: TooltipContentProps<ValueType, NameType>) => {
    if (!active || !payload?.length) return null;
    const items = payload.filter((p) => typeof p.value === "number" && p.value > 0);
    const total = items.reduce((s, p) => s + (p.value as number), 0);
    return (
      <div className="min-w-48 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
        <div className="mb-1.5 font-medium">{dayLabel(String(day), true)}</div>
        {items.length === 0 && <div className="text-muted-foreground">No usage</div>}
        {items
          .slice()
          .reverse()
          .map((p) => {
            const s = series.find((x) => x.key === p.dataKey);
            return (
              <div key={String(p.dataKey)} className="flex items-center justify-between gap-4 py-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm" style={{ background: s?.color }} />
                  {label(String(p.dataKey), s)}
                </span>
                <span className="tabular-nums">{formatValue(metric, p.value as number)}</span>
              </div>
            );
          })}
        {items.length > 1 && (
          <div className="mt-1 flex justify-between border-t pt-1 font-medium">
            <span>Total</span>
            <span className="tabular-nums">{formatValue(metric, total)}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="day"
              tickFormatter={(d) => dayLabel(String(d))}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <YAxis
              tickFormatter={(v) => formatAxis(metric, Number(v))}
              tickLine={false}
              axisLine={false}
              width={64}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <Tooltip content={TooltipBody} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="usage"
                fill={s.color}
                stroke="var(--card)"
                strokeWidth={1}
                radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                maxBarSize={36}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {series.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
              {label(s.key, s)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
