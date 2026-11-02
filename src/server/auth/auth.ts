import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { env } from "@/config/env";
import { getDb } from "@/server/db";

function createAuth() {
  const e = env();
  return betterAuth({
    appName: "Obot",
    baseURL: e.APP_URL,
    trustedOrigins: e.TRUSTED_ORIGINS,
    secret: e.BETTER_AUTH_SECRET,
    database: prismaAdapter(getDb(), { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      // Public sign-up is closed: accounts are created by /api/register (first user or invite).
      disableSignUp: true,
      minPasswordLength: 8,
      maxPasswordLength: 256,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const user = await getDb().user.findUnique({
              where: { id: session.userId },
              select: { status: true },
            });
            if (!user || user.status !== "ACTIVE") return false;
            return { data: session };
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const g = globalThis as unknown as { __obotAuth?: Auth };

export function auth(): Auth {
  if (!g.__obotAuth) g.__obotAuth = createAuth();
  return g.__obotAuth;
}
