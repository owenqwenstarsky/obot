import "server-only";
import { db } from "@/server/db";
import type { AppSettings } from "@/generated/prisma/client";
import type { AgentFlags } from "@/server/agent/tools/types";

export async function getSettings(): Promise<AppSettings> {
  const existing = await db.appSettings.findUnique({ where: { id: "global" } });
  if (existing) return existing;
  return db.appSettings.upsert({ where: { id: "global" }, update: {}, create: { id: "global" } });
}

export function webSearchContextSize(value: string): "low" | "medium" | "high" {
  return value === "low" || value === "high" ? value : "medium";
}

/** Feature flags that decide which local tools runs get. */
export async function getAgentFlags(settings?: AppSettings): Promise<AgentFlags> {
  const s = settings ?? (await getSettings());
  const subagentModelCount = s.subagentsEnabled ? await db.subagentModel.count({ where: { model: { enabled: true, available: true } } }) : 0;
  return {
    sandboxEnabled: s.sandboxEnabled,
    sandboxPythonEnabled: s.sandboxPythonEnabled,
    artifactsEnabled: s.artifactsEnabled,
    inlineUiEnabled: s.inlineUiEnabled,
    subagentsEnabled: s.subagentsEnabled,
    subagentMaxConcurrent: s.subagentMaxConcurrent,
    subagentModelCount,
  };
}
