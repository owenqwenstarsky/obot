export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.DATABASE_URL) return;
  try {
    const { recoverInterruptedRuns } = await import("@/server/agent/runtime");
    const n = await recoverInterruptedRuns();
    if (n > 0) console.log(`[obot] marked ${n} interrupted run(s) from a previous process`);
    const { maybeSyncModels } = await import("@/server/llm/models");
    void maybeSyncModels();
  } catch (err) {
    console.error("[obot] startup recovery failed", err);
  }
}
