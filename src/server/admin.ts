import "server-only";
import { db } from "@/server/db";
import { HttpError, notFound } from "@/server/auth/errors";
import { monthWindow, resolveLimits, weekWindow } from "@/server/billing/limits";
import { getSettings } from "@/server/settings";
import { newInviteToken } from "@/server/auth/tokens";
import { env } from "@/config/env";
import { dollarsToMicros } from "@/lib/money";
import type { CurrentUser } from "@/server/auth/session";

async function spendByUser(from: Date, to: Date) {
  const rows = await db.usageRecord.groupBy({
    by: ["userId"],
    where: { createdAt: { gte: from, lt: to } },
    _sum: { costMicros: true },
  });
  return new Map(rows.map((r) => [r.userId, r._sum.costMicros ?? 0n]));
}

export async function listUsersForAdmin() {
  const now = new Date();
  const week = weekWindow(now);
  const month = monthWindow(now);
  const [users, settings, weekly, monthly] = await Promise.all([
    db.user.findMany({ orderBy: { createdAt: "asc" } }),
    getSettings(),
    spendByUser(week.start, week.end),
    spendByUser(month.start, month.end),
  ]);
  return users.map((u) => {
    const limits = resolveLimits(u, settings);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt.toISOString(),
      limitMode: u.limitMode,
      weeklyLimitMicros: u.weeklyLimitMicros != null ? Number(u.weeklyLimitMicros) : null,
      monthlyLimitMicros: u.monthlyLimitMicros != null ? Number(u.monthlyLimitMicros) : null,
      effective: {
        unlimited: limits.unlimited,
        weeklyMicros: limits.weekly != null ? Number(limits.weekly) : null,
        monthlyMicros: limits.monthly != null ? Number(limits.monthly) : null,
      },
      spentWeekMicros: Number(weekly.get(u.id) ?? 0n),
      spentMonthMicros: Number(monthly.get(u.id) ?? 0n),
    };
  });
}

export type UserPatch = {
  role?: "USER" | "ADMIN";
  status?: "ACTIVE" | "DISABLED";
  limitMode?: "INHERIT" | "CUSTOM" | "UNLIMITED";
  weeklyLimit?: number | null;
  monthlyLimit?: number | null;
};

export async function updateUserAsAdmin(actor: CurrentUser, userId: string, patch: UserPatch) {
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) throw notFound("User");

  const demoting = patch.role === "USER" && target.role === "ADMIN";
  const disabling = patch.status === "DISABLED" && target.status === "ACTIVE";
  if ((demoting || disabling) && target.role === "ADMIN") {
    const otherAdmins = await db.user.count({ where: { role: "ADMIN", status: "ACTIVE", id: { not: userId } } });
    if (otherAdmins === 0) throw new HttpError(400, "You can't remove the last active admin.", "LAST_ADMIN");
  }
  if (disabling && actor.id === userId) throw new HttpError(400, "You can't disable your own account.", "SELF_DISABLE");

  const data: Record<string, unknown> = {};
  if (patch.role) data.role = patch.role;
  if (patch.status) data.status = patch.status;
  if (patch.limitMode) data.limitMode = patch.limitMode;
  if (patch.weeklyLimit !== undefined) data.weeklyLimitMicros = patch.weeklyLimit == null ? null : dollarsToMicros(patch.weeklyLimit);
  if (patch.monthlyLimit !== undefined) data.monthlyLimitMicros = patch.monthlyLimit == null ? null : dollarsToMicros(patch.monthlyLimit);

  await db.user.update({ where: { id: userId }, data });
  if (disabling) await db.session.deleteMany({ where: { userId } });
}

export async function listInvites() {
  const invites = await db.invite.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { createdBy: { select: { email: true } }, usedBy: { select: { email: true } } },
  });
  const now = new Date();
  return invites.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    note: i.note,
    createdAt: i.createdAt.toISOString(),
    expiresAt: i.expiresAt.toISOString(),
    usedAt: i.usedAt?.toISOString() ?? null,
    usedBy: i.usedBy?.email ?? null,
    createdBy: i.createdBy.email,
    revokedAt: i.revokedAt?.toISOString() ?? null,
    state: i.revokedAt ? "revoked" : i.usedAt ? "used" : i.expiresAt <= now ? "expired" : "active",
  }));
}

export async function createInvite(actor: CurrentUser, args: { email?: string | null; role: "USER" | "ADMIN"; expiresInDays: number; note?: string | null }) {
  const { token, hash } = newInviteToken();
  const invite = await db.invite.create({
    data: {
      tokenHash: hash,
      email: args.email?.trim().toLowerCase() || null,
      role: args.role,
      note: args.note?.trim() || null,
      createdById: actor.id,
      expiresAt: new Date(Date.now() + args.expiresInDays * 24 * 60 * 60 * 1000),
    },
  });
  // The raw token is only ever returned once, at creation.
  return { id: invite.id, url: `${env().APP_URL}/invite/${token}` };
}

export async function revokeInvite(id: string) {
  const res = await db.invite.updateMany({ where: { id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  if (res.count === 0) throw notFound("Active invite");
}
