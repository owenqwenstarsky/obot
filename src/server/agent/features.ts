/**
 * Registers feature services/hooks with the runtime. Imported by turns.ts so registration
 * happens before any run starts.
 */
import "server-only";
import { registerServiceFactory, registerSettledHook, registerThreadDeleteHook } from "@/server/agent/runtime";
import { sandboxes } from "@/server/sandbox";
import { prismaArtifactStore } from "@/server/artifacts";
import { createArtifactApi, finalizePendingArtifact } from "@/server/artifacts/core";

registerServiceFactory("sandbox", (p) => {
  const id = p.rootThreadId ?? p.threadId;
  return {
    sandbox: {
      exec: (command, opts) => sandboxes().exec(id, command, opts),
      writeFile: (path, content) => sandboxes().writeFile(id, path, content),
    },
  };
});

registerThreadDeleteHook("sandbox", (threadId) => sandboxes().delete(threadId));

registerServiceFactory("artifacts", (p) => ({
  artifacts: createArtifactApi(prismaArtifactStore, {
    userId: p.userId,
    threadId: p.threadId,
    runId: p.runId,
    messageId: p.messageId,
    pendingArtifactId: typeof p.meta?.pendingArtifactId === "string" ? p.meta.pendingArtifactId : null,
  }),
}));

registerSettledHook("artifacts", async (r) => {
  const pendingArtifactId = r.meta.pendingArtifactId;
  if (typeof pendingArtifactId !== "string") return;
  await finalizePendingArtifact(prismaArtifactStore, { pendingArtifactId, runStatus: r.runStatus, error: r.error });
});
