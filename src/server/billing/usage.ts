import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { computeCost, pickActivePrice } from "@/server/billing/pricing";
import {
  evaluateSpend,
  evaluateUnpriced,
  monthWindow,
  resolveLimits,
  weekWindow,
  type LimitDecision,
  type ResolvedLimits,
} from "@/server/billing/limits";
import { getSettings } from "@/server/settings";
import type { UsageSnapshot } from "@/lib/parts";

export type RecordUsageArgs = {
  userId: string;
  threadId?: string | null;
  messageId?: string | null;
  runId?: string | null;
  kind: "CHAT" | "TITLE";
  modelId: string;
  effort?: string | null;
  usage: UsageSnapshot;
  webSearchCalls: number;
  responseId?: string | null;
  note?: string | null;
};

/** Append a usage record. Records are immutable (enforced by a DB trigger). */
export async function recordUsage(args: RecordUsageArgs) {
  const now = new Date();
  const prices = await db.modelPrice.findMany({
    where: { modelId: args.modelId, effectiveFrom: { lte: now } },
    orderBy: { effectiveFrom: "desc" },
    take: 1,
  });
  const price = pickActivePrice(prices, now);
  const cost = price ? computeCost(args.usage, args.webSearchCalls, price) : null;

  return db.usageRecord.create({
    data: {
      userId: args.userId,
      threadId: args.threadId ?? null,
      messageId: args.messageId ?? null,
      runId: args.runId ?? null,
      kind: args.kind,
      modelId: args.modelId,
      effort: args.effort ?? null,
      inputTokens: args.usage.inputTokens,
      cachedInputTokens: args.usage.cachedInputTokens,
      cacheWriteTokens: args.usage.cacheWriteTokens,
      outputTokens: args.usage.outputTokens,
      reasoningTokens: args.usage.reasoningTokens,
      totalTokens: args.usage.totalTokens,
      webSearchCalls: args.webSearchCalls,
      costMicros: cost?.totalMicros ?? 0n,
      priced: !!price,
      priceId: price?.id ?? null,
      responseId: args.responseId ?? null,
      note: args.note ?? (cost?.longContextApplied ? "long-context pricing applied" : null),
    },
  });
}

async function sumCost(userId: string, from: Date, to: Date): Promise<bigint> {
  const res = await db.usageRecord.aggregate({
    where: { userId, createdAt: { gte: from, lt: to } },
    _sum: { costMicros: true },
  });
  return res._sum.costMicros ?? 0n;
}

export type LimitStatus = {
  limits: ResolvedLimits;
  weekly: { spentMicros: bigint; limitMicros: bigint | null; resetsAt: Date };
  monthly: { spentMicros: bigint; limitMicros: bigint | null; resetsAt: Date };
};

export async function getLimitStatus(userId: string, now = new Date()): Promise<LimitStatus> {
  const [user, settings] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { limitMode: true, weeklyLimitMicros: true, monthlyLimitMicros: true },
    }),
    getSettings(),
  ]);
  const limits = resolveLimits(user, settings);
  const week = weekWindow(now);
  const month = monthWindow(now);
  const [weekly, monthly] = await Promise.all([
    sumCost(userId, week.start, week.end),
    sumCost(userId, month.start, month.end),
  ]);
  return {
    limits,
    weekly: { spentMicros: weekly, limitMicros: limits.unlimited ? null : limits.weekly, resetsAt: week.end },
    monthly: { spentMicros: monthly, limitMicros: limits.unlimited ? null : limits.monthly, resetsAt: month.end },
  };
}

/** Pre-run gate: spend caps + unpriced-model policy. */
export async function checkCanRun(userId: string, modelHasPrice: boolean): Promise<LimitDecision> {
  const now = new Date();
  const [status, settings] = await Promise.all([getLimitStatus(userId, now), getSettings()]);
  const unpriced = evaluateUnpriced(settings.unpricedModelPolicy, status.limits, modelHasPrice);
  if (!unpriced.allowed) return unpriced;
  return evaluateSpend(
    status.limits,
    { weekly: status.weekly.spentMicros, monthly: status.monthly.spentMicros },
    now,
  );
}

// ───────────────────────────── Reporting ─────────────────────────────

export type UsageQuery = {
  userId?: string | null;
  from: Date | null;
  to: Date | null;
  timeZone: string;
};

export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

function whereSql(q: UsageQuery) {
  const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (q.userId) conds.push(Prisma.sql`"userId" = ${q.userId}`);
  if (q.from) conds.push(Prisma.sql`"createdAt" >= ${q.from}`);
  if (q.to) conds.push(Prisma.sql`"createdAt" < ${q.to}`);
  return Prisma.join(conds, " AND ");
}

type TotalsRow = {
  requests: bigint;
  cost: bigint;
  input: bigint;
  cached: bigint;
  output: bigint;
  reasoning: bigint;
  total: bigint;
  searches: bigint;
};

export async function getUsageReport(q: UsageQuery) {
  const where = whereSql(q);
  const tz = safeTimeZone(q.timeZone);

  const [totals] = await db.$queryRaw<TotalsRow[]>`
    SELECT COUNT(*)::bigint AS requests,
           COALESCE(SUM("costMicros"),0)::bigint AS cost,
           COALESCE(SUM("inputTokens"),0)::bigint AS input,
           COALESCE(SUM("cachedInputTokens"),0)::bigint AS cached,
           COALESCE(SUM("outputTokens"),0)::bigint AS output,
           COALESCE(SUM("reasoningTokens"),0)::bigint AS reasoning,
           COALESCE(SUM("totalTokens"),0)::bigint AS total,
           COALESCE(SUM("webSearchCalls"),0)::bigint AS searches
    FROM "usage_record" WHERE ${where}`;

  const byDay = await db.$queryRaw<{ day: string; modelId: string; cost: bigint; requests: bigint; tokens: bigint }[]>`
    SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day,
           "modelId",
           COALESCE(SUM("costMicros"),0)::bigint AS cost,
           COUNT(*)::bigint AS requests,
           COALESCE(SUM("totalTokens"),0)::bigint AS tokens
    FROM "usage_record" WHERE ${where}
    GROUP BY 1, 2 ORDER BY 1 ASC`;

  const byModel = await db.$queryRaw<(TotalsRow & { modelId: string })[]>`
    SELECT "modelId",
           COUNT(*)::bigint AS requests,
           COALESCE(SUM("costMicros"),0)::bigint AS cost,
           COALESCE(SUM("inputTokens"),0)::bigint AS input,
           COALESCE(SUM("cachedInputTokens"),0)::bigint AS cached,
           COALESCE(SUM("outputTokens"),0)::bigint AS output,
           COALESCE(SUM("reasoningTokens"),0)::bigint AS reasoning,
           COALESCE(SUM("totalTokens"),0)::bigint AS total,
           COALESCE(SUM("webSearchCalls"),0)::bigint AS searches
    FROM "usage_record" WHERE ${where}
    GROUP BY "modelId" ORDER BY cost DESC, requests DESC`;

  const t = totals ?? { requests: 0n, cost: 0n, input: 0n, cached: 0n, output: 0n, reasoning: 0n, total: 0n, searches: 0n };
  const n = (v: bigint) => Number(v);
  return {
    timeZone: tz,
    totals: {
      requests: n(t.requests),
      costMicros: n(t.cost),
      inputTokens: n(t.input),
      cachedInputTokens: n(t.cached),
      outputTokens: n(t.output),
      reasoningTokens: n(t.reasoning),
      totalTokens: n(t.total),
      webSearchCalls: n(t.searches),
    },
    byDay: byDay.map((r) => ({
      day: r.day,
      modelId: r.modelId,
      costMicros: n(r.cost),
      requests: n(r.requests),
      tokens: n(r.tokens),
    })),
    byModel: byModel.map((r) => ({
      modelId: r.modelId,
      requests: n(r.requests),
      costMicros: n(r.cost),
      inputTokens: n(r.input),
      cachedInputTokens: n(r.cached),
      outputTokens: n(r.output),
      reasoningTokens: n(r.reasoning),
      totalTokens: n(r.total),
      webSearchCalls: n(r.searches),
    })),
  };
}

export async function getUsageRecords(q: UsageQuery & { page: number; pageSize: number }) {
  const where: Prisma.UsageRecordWhereInput = {
    ...(q.userId ? { userId: q.userId } : {}),
    createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) },
  };
  const [total, rows] = await Promise.all([
    db.usageRecord.count({ where }),
    db.usageRecord.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { user: { select: { email: true, name: true } } },
    }),
  ]);
  return { total, rows: rows.map(serializeUsageRecord) };
}

export function serializeUsageRecord(r: Prisma.UsageRecordGetPayload<{ include: { user: { select: { email: true; name: true } } } }>) {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    userId: r.userId,
    userEmail: r.user.email,
    userName: r.user.name,
    threadId: r.threadId,
    kind: r.kind,
    modelId: r.modelId,
    effort: r.effort,
    inputTokens: r.inputTokens,
    cachedInputTokens: r.cachedInputTokens,
    cacheWriteTokens: r.cacheWriteTokens,
    outputTokens: r.outputTokens,
    reasoningTokens: r.reasoningTokens,
    totalTokens: r.totalTokens,
    webSearchCalls: r.webSearchCalls,
    costMicros: Number(r.costMicros),
    priced: r.priced,
    note: r.note,
  };
}

export type SerializedUsageRecord = ReturnType<typeof serializeUsageRecord>;
