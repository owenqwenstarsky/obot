import "server-only";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { db } from "@/server/db";
import { HttpError } from "@/server/auth/errors";
import { decideRegistration } from "@/server/auth/policy";
import { hashToken } from "@/server/auth/tokens";

const REGISTRATION_LOCK_KEY = 7_105_116; // arbitrary constant for pg_advisory_xact_lock

export type RegisterInput = { name: string; email: string; password: string; inviteToken?: string | null };

/**
 * Creates a user + credential account. The first user ever becomes ADMIN; everyone
 * else needs a valid invite. Serialized with an advisory lock so two simultaneous
 * "first" registrations can't both become admin.
 */
export async function registerUser(input: RegisterInput) {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  const tokenHash = input.inviteToken ? hashToken(input.inviteToken) : null;

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REGISTRATION_LOCK_KEY})`;
    const userCount = await tx.user.count();
    const invite = tokenHash ? await tx.invite.findUnique({ where: { tokenHash } }) : null;
    const decision = decideRegistration({ userCount, email, invite, now: new Date() });
    if (!decision.ok) throw new HttpError(403, decision.reason, "REGISTRATION_DENIED");

    const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new HttpError(409, "An account with this email already exists.", "EMAIL_TAKEN");

    const userId = randomUUID();
    const user = await tx.user.create({
      data: { id: userId, name: input.name.trim(), email, role: decision.role, emailVerified: false },
    });
    await tx.account.create({
      data: {
        id: randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: passwordHash,
      },
    });
    if (decision.consumeInviteId) {
      const consumed = await tx.invite.updateMany({
        where: { id: decision.consumeInviteId, usedAt: null, revokedAt: null },
        data: { usedAt: new Date(), usedById: userId },
      });
      if (consumed.count !== 1) throw new HttpError(409, "This invite has already been used.", "INVITE_USED");
    }
    return user;
  });
}

export async function isFirstRun(): Promise<boolean> {
  return (await db.user.count()) === 0;
}

export async function lookupInvite(token: string) {
  const invite = await db.invite.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invite) return { valid: false as const, reason: "This invite link is invalid." };
  if (invite.revokedAt) return { valid: false as const, reason: "This invite has been revoked." };
  if (invite.usedAt) return { valid: false as const, reason: "This invite has already been used." };
  if (invite.expiresAt <= new Date()) return { valid: false as const, reason: "This invite has expired." };
  return { valid: true as const, email: invite.email, role: invite.role };
}
