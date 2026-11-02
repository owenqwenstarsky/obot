"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, Infinity as InfinityIcon } from "lucide-react";
import { api } from "@/lib/api";
import { formatTokens, formatUsd } from "@/lib/money";
import { effortLabel } from "@/lib/efforts";
import { presetRange } from "@/lib/date-ranges";
import { useLimits, useModels } from "@/hooks/queries";
import type { UsageRecordRow, UsageReport } from "./types";
import { UsageChart, type ChartMetric } from "./usage-chart";
import { RangePicker, type RangeValue } from "./range-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { MODEL_METADATA } from "@/config/model-metadata";

const PAGE_SIZE = 25;
const META_NAMES = new Map(MODEL_METADATA.map((m) => [m.id, m.displayName]));

export function UsageDashboard({
  scope,
  users,
}: {
  scope: "me" | "admin";
  users?: { id: string; name: string; email: string }[];
}) {
  const [range, setRange] = useState<RangeValue>({ preset: "this_month", range: presetRange("this_month") });
  const [metric, setMetric] = useState<ChartMetric>("cost");
  const [page, setPage] = useState(1);
  const [userId, setUserId] = useState<string>("all");
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const params = useMemo(() => {
    const p = new URLSearchParams({ tz });
    if (range.range.from) p.set("from", range.range.from.toISOString());
    if (range.range.to) p.set("to", range.range.to.toISOString());
    if (scope === "admin" && userId !== "all") p.set("userId", userId);
    return p;
  }, [range, tz, scope, userId]);

  const base = scope === "me" ? "/api/me/usage" : "/api/admin/usage";

  const report = useQuery({
    queryKey: ["usage", scope, params.toString()],
    queryFn: () => api<UsageReport>(`${base}?${params}`),
    placeholderData: keepPreviousData,
  });

  const records = useQuery({
    queryKey: ["usage-records", scope, params.toString(), page],
    queryFn: () =>
      api<{ total: number; rows: UsageRecordRow[] }>(`${base}/records?${params}&page=${page}&pageSize=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });

  const { data: modelsData } = useModels();
  const modelNames = useMemo(
    () => new Map([...META_NAMES, ...(modelsData?.models ?? []).map((m) => [m.id, m.displayName] as const)]),
    [modelsData],
  );
  const t = report.data?.totals;
  const pages = records.data ? Math.max(1, Math.ceil(records.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {scope === "admin" && users && (
          <Select
            value={userId}
            onValueChange={(v) => {
              setUserId(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All users</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name} · {u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <RangePicker
          value={range}
          onChange={(v) => {
            setRange(v);
            setPage(1);
          }}
        />
        <Button variant="outline" className="ml-auto h-9" asChild>
          <a href={`${base}/export?${params}`}>
            <Download className="size-4" /> Export CSV
          </a>
        </Button>
      </div>

      {scope === "me" && <LimitMeters />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Spend" value={t ? formatUsd(t.costMicros) : null} />
        <Stat label="Requests" value={t ? t.requests.toLocaleString() : null} />
        <Stat
          label="Tokens"
          value={t ? formatTokens(t.totalTokens) : null}
          sub={t ? `${formatTokens(t.inputTokens)} in · ${formatTokens(t.outputTokens)} out · ${formatTokens(t.reasoningTokens)} reasoning` : undefined}
        />
        <Stat label="Web searches" value={t ? t.webSearchCalls.toLocaleString() : null} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">
            {metric === "cost" ? "Spend" : metric === "tokens" ? "Tokens" : "Requests"} per day
          </CardTitle>
          <div className="flex rounded-lg bg-muted p-0.5">
            {(["cost", "tokens", "requests"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                aria-pressed={metric === m}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground",
                  metric === m && "bg-background text-foreground shadow-sm",
                )}
              >
                {m === "cost" ? "Spend" : m === "tokens" ? "Tokens" : "Requests"}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {report.data ? (
            <UsageChart report={report.data} from={range.range.from} to={range.range.to} metric={metric} modelNames={modelNames} />
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By model</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Model</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Cached</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Reasoning</TableHead>
                <TableHead className="text-right">Searches</TableHead>
                <TableHead className="pr-6 text-right">Spend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(report.data?.byModel ?? []).map((m) => (
                <TableRow key={m.modelId}>
                  <TableCell className="pl-6 font-medium">{modelNames.get(m.modelId) ?? m.modelId}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.requests.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTokens(m.inputTokens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTokens(m.cachedInputTokens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTokens(m.outputTokens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTokens(m.reasoningTokens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.webSearchCalls.toLocaleString()}</TableCell>
                  <TableCell className="pr-6 text-right font-medium tabular-nums">{formatUsd(m.costMicros)}</TableCell>
                </TableRow>
              ))}
              {report.data && report.data.byModel.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    No usage in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Requests</CardTitle>
          <span className="text-xs text-muted-foreground">
            {records.data ? `${records.data.total.toLocaleString()} total` : ""}
          </span>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Time</TableHead>
                {scope === "admin" && <TableHead>User</TableHead>}
                <TableHead>Model</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Searches</TableHead>
                <TableHead className="pr-6 text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(records.data?.rows ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-6 whitespace-nowrap text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  {scope === "admin" && <TableCell className="max-w-48 truncate">{r.userEmail}</TableCell>}
                  <TableCell className="whitespace-nowrap">
                    {modelNames.get(r.modelId) ?? r.modelId}
                    {r.effort && <span className="ml-1.5 text-xs text-muted-foreground">{effortLabel(r.effort)}</span>}
                  </TableCell>
                  <TableCell>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.kind === "TITLE" ? "Title" : "Chat"}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.inputTokens.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.outputTokens.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.webSearchCalls}</TableCell>
                  <TableCell className="pr-6 text-right tabular-nums" title={r.note ?? undefined}>
                    {r.priced ? formatUsd(r.costMicros, { precise: true }) : <span className="text-muted-foreground">Unpriced</span>}
                  </TableCell>
                </TableRow>
              ))}
              {records.data && records.data.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={scope === "admin" ? 8 : 7} className="py-8 text-center text-muted-foreground">
                    No requests in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 px-6 pt-3 text-sm">
              <span className="text-muted-foreground">
                Page {page} of {pages}
              </span>
              <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | null; sub?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        {value == null ? <Skeleton className="mt-1.5 h-7 w-24" /> : <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>}
        {sub && <div className="mt-1 truncate text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function LimitMeters() {
  const { data } = useLimits();
  if (!data) return <Skeleton className="h-20 w-full" />;
  const fmtReset = (iso: string) =>
    `${new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}, 00:00 UTC`;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(
        [
          ["This week", data.weekly],
          ["This month", data.monthly],
        ] as const
      ).map(([label, w]) => {
        const pct = w.limitMicros ? Math.min(1, w.spentMicros / w.limitMicros) : 0;
        return (
          <Card key={label} className="gap-2 py-4">
            <CardContent className="space-y-2 px-4">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatUsd(w.spentMicros)}
                  {w.limitMicros != null ? (
                    <> / {formatUsd(w.limitMicros)}</>
                  ) : (
                    <span className="ml-1 inline-flex items-center gap-1">
                      · <InfinityIcon className="size-3.5" /> no limit
                    </span>
                  )}
                </span>
              </div>
              {w.limitMicros != null && (
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full transition-all", pct >= 1 ? "bg-destructive" : pct >= 0.8 ? "bg-amber-500" : "bg-primary")}
                    style={{ width: `${pct * 100}%` }}
                  />
                </div>
              )}
              <div className="text-xs text-muted-foreground">Resets {fmtReset(w.resetsAt)}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
