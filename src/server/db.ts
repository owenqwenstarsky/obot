import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/config/env";

const globalForPrisma = globalThis as unknown as { __obotPrisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL });
  return new PrismaClient({ adapter });
}

export function getDb(): PrismaClient {
  if (!globalForPrisma.__obotPrisma) globalForPrisma.__obotPrisma = createClient();
  return globalForPrisma.__obotPrisma;
}

/** Proxy so modules can `import { db }` without connecting at import time. */
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getDb() as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});
