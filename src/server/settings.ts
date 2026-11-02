import "server-only";
import { db } from "@/server/db";
import type { AppSettings } from "@/generated/prisma/client";

export async function getSettings(): Promise<AppSettings> {
  const existing = await db.appSettings.findUnique({ where: { id: "global" } });
  if (existing) return existing;
  return db.appSettings.upsert({ where: { id: "global" }, update: {}, create: { id: "global" } });
}

export function webSearchContextSize(value: string): "low" | "medium" | "high" {
  return value === "low" || value === "high" ? value : "medium";
}
