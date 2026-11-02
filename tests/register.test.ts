import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-memory fake of the Prisma surface used by registerUser. `$transaction` callbacks are
 * serialized, emulating the Postgres advisory lock the real code takes.
 */
type U = { id: string; email: string; role: "USER" | "ADMIN"; name: string };
type I = { id: string; tokenHash: string; email: string | null; role: "USER" | "ADMIN"; expiresAt: Date; usedAt: Date | null; usedById?: string | null; revokedAt: Date | null };

const state = { users: [] as U[], accounts: [] as { userId: string; providerId: string; password: string }[], invites: [] as I[] };
let lock: Promise<unknown> = Promise.resolve();

const tx = {
  $executeRaw: async () => 0,
  user: {
    count: async () => state.users.length,
    findUnique: async ({ where }: { where: { email: string } }) => state.users.find((u) => u.email === where.email) ?? null,
    create: async ({ data }: { data: U }) => {
      await new Promise((r) => setTimeout(r, 5)); // widen the race window
      state.users.push(data);
      return data;
    },
  },
  account: { create: async ({ data }: { data: { userId: string; providerId: string; password: string } }) => state.accounts.push(data) },
  invite: {
    findUnique: async ({ where }: { where: { tokenHash: string } }) => state.invites.find((i) => i.tokenHash === where.tokenHash) ?? null,
    updateMany: async ({ where, data }: { where: { id: string }; data: Partial<I> }) => {
      const inv = state.invites.find((i) => i.id === where.id && !i.usedAt && !i.revokedAt);
      if (!inv) return { count: 0 };
      Object.assign(inv, data);
      return { count: 1 };
    },
  },
};

vi.mock("@/server/db", () => ({
  db: {
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => {
      const next = lock.then(() => fn(tx));
      lock = next.catch(() => undefined);
      return next;
    },
  },
}));
vi.mock("better-auth/crypto", () => ({ hashPassword: async (p: string) => `hashed:${p}` }));

const { registerUser } = await import("@/server/auth/register");
const { hashToken } = await import("@/server/auth/tokens");

beforeEach(() => {
  state.users = [];
  state.accounts = [];
  state.invites = [];
  lock = Promise.resolve();
});

describe("registerUser", () => {
  it("only one of two simultaneous first registrations becomes admin", async () => {
    const results = await Promise.allSettled([
      registerUser({ name: "A", email: "a@x.com", password: "password1" }),
      registerUser({ name: "B", email: "b@x.com", password: "password2" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    expect(state.users).toHaveLength(1);
    expect(state.users[0].role).toBe("ADMIN");
    expect(state.accounts[0]).toMatchObject({ providerId: "credential", password: "hashed:password1" });
  });

  it("consumes an invite exactly once and applies its role", async () => {
    state.users.push({ id: "root", email: "root@x.com", role: "ADMIN", name: "Root" });
    state.invites.push({ id: "inv1", tokenHash: hashToken("tok"), email: null, role: "USER", expiresAt: new Date(Date.now() + 86_400_000), usedAt: null, revokedAt: null });

    const results = await Promise.allSettled([
      registerUser({ name: "C", email: "c@x.com", password: "password3", inviteToken: "tok" }),
      registerUser({ name: "D", email: "d@x.com", password: "password4", inviteToken: "tok" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(state.users.filter((u) => u.role === "USER")).toHaveLength(1);
    expect(state.invites[0].usedAt).not.toBeNull();
  });

  it("rejects registration without an invite once a user exists, and duplicate emails", async () => {
    state.users.push({ id: "root", email: "root@x.com", role: "ADMIN", name: "Root" });
    await expect(registerUser({ name: "E", email: "e@x.com", password: "password5" })).rejects.toMatchObject({ status: 403 });

    state.invites.push({ id: "inv2", tokenHash: hashToken("tok2"), email: null, role: "USER", expiresAt: new Date(Date.now() + 86_400_000), usedAt: null, revokedAt: null });
    await expect(registerUser({ name: "R", email: "ROOT@x.com", password: "password6", inviteToken: "tok2" })).rejects.toMatchObject({ status: 409 });
  });
});
