import { describe, expect, it } from "vitest";
import { canAccessOwned, canUseApp, canViewUsageOf, decideRegistration, isAdmin, type InviteLike } from "@/server/auth/policy";

const now = new Date("2026-11-02T12:00:00Z");
const invite = (over: Partial<InviteLike> = {}): InviteLike => ({
  id: "inv",
  email: null,
  role: "USER",
  expiresAt: new Date("2026-11-09T00:00:00Z"),
  usedAt: null,
  revokedAt: null,
  ...over,
});

describe("decideRegistration", () => {
  it("first user becomes admin without an invite", () => {
    expect(decideRegistration({ userCount: 0, email: "a@b.c", invite: null, now })).toEqual({ ok: true, role: "ADMIN", consumeInviteId: null });
  });

  it("later users need a valid invite", () => {
    expect(decideRegistration({ userCount: 1, email: "a@b.c", invite: null, now }).ok).toBe(false);
    expect(decideRegistration({ userCount: 1, email: "a@b.c", invite: invite(), now })).toEqual({ ok: true, role: "USER", consumeInviteId: "inv" });
    expect(decideRegistration({ userCount: 1, email: "a@b.c", invite: invite({ role: "ADMIN" }), now })).toMatchObject({ role: "ADMIN" });
  });

  it("rejects used, revoked, expired, or wrong-email invites", () => {
    const deny = (i: InviteLike, email = "a@b.c") => decideRegistration({ userCount: 3, email, invite: i, now }).ok;
    expect(deny(invite({ usedAt: now }))).toBe(false);
    expect(deny(invite({ revokedAt: now }))).toBe(false);
    expect(deny(invite({ expiresAt: now }))).toBe(false);
    expect(deny(invite({ email: "x@y.z" }))).toBe(false);
    expect(deny(invite({ email: "A@B.C" }))).toBe(true);
  });
});

describe("access rules", () => {
  const alice = { id: "alice", role: "USER" as const, status: "ACTIVE" as const };
  const admin = { id: "root", role: "ADMIN" as const, status: "ACTIVE" as const };
  const disabled = { id: "bob", role: "ADMIN" as const, status: "DISABLED" as const };

  it("owner-only access to threads, even for admins", () => {
    expect(canAccessOwned(alice, "alice")).toBe(true);
    expect(canAccessOwned(alice, "bob")).toBe(false);
    expect(canAccessOwned(admin, "alice")).toBe(false);
  });

  it("admins can view anyone's usage; users only their own", () => {
    expect(canViewUsageOf(alice, "alice")).toBe(true);
    expect(canViewUsageOf(alice, "root")).toBe(false);
    expect(canViewUsageOf(admin, "alice")).toBe(true);
  });

  it("disabled users have no access at all", () => {
    expect(canUseApp(disabled)).toBe(false);
    expect(isAdmin(disabled)).toBe(false);
    expect(canViewUsageOf(disabled, "bob")).toBe(false);
    expect(canUseApp(null)).toBe(false);
  });
});
