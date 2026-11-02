/** Pure authorization rules (unit-tested). */

export type Principal = { id: string; role: "USER" | "ADMIN"; status: "ACTIVE" | "DISABLED" };

export function canUseApp(p: Principal | null): p is Principal {
  return !!p && p.status === "ACTIVE";
}

export function isAdmin(p: Principal | null): boolean {
  return canUseApp(p) && p.role === "ADMIN";
}

/** Threads/messages/runs/attachments are strictly owner-only (admins included). */
export function canAccessOwned(p: Principal | null, ownerId: string): boolean {
  return canUseApp(p) && p.id === ownerId;
}

/** Usage data: owners see their own; admins see anyone's. */
export function canViewUsageOf(p: Principal | null, userId: string): boolean {
  return canUseApp(p) && (p.id === userId || p.role === "ADMIN");
}

export type RegistrationDecision =
  | { ok: true; role: "USER" | "ADMIN"; consumeInviteId: string | null }
  | { ok: false; reason: string };

export type InviteLike = {
  id: string;
  email: string | null;
  role: "USER" | "ADMIN";
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
};

/** Decide whether a registration may proceed. `userCount` must be read under a lock. */
export function decideRegistration(args: {
  userCount: number;
  email: string;
  invite: InviteLike | null;
  now: Date;
}): RegistrationDecision {
  if (args.userCount === 0) return { ok: true, role: "ADMIN", consumeInviteId: null };
  const inv = args.invite;
  if (!inv) return { ok: false, reason: "Sign-up is invite-only. Ask an admin for an invite link." };
  if (inv.revokedAt) return { ok: false, reason: "This invite has been revoked." };
  if (inv.usedAt) return { ok: false, reason: "This invite has already been used." };
  if (inv.expiresAt.getTime() <= args.now.getTime()) return { ok: false, reason: "This invite has expired." };
  if (inv.email && inv.email.toLowerCase() !== args.email.toLowerCase()) {
    return { ok: false, reason: "This invite was issued for a different email address." };
  }
  return { ok: true, role: inv.role, consumeInviteId: inv.id };
}
