/**
 * Registers feature services/hooks with the runtime. Imported by turns.ts so registration
 * happens before any run starts.
 */
import "server-only";
import {
  registerServiceFactory,
  registerSettledHook,
  registerThreadDeleteHook,
  registerWatcherFactory,
} from "@/server/agent/runtime";
import { subagents } from "@/server/subagents";
import { sandboxes } from "@/server/sandbox";
import { undiciRequester } from "@/server/web";
import { fetchUrl } from "@/server/web/fetch-url";
import { addMemory, deleteMemory } from "@/server/memories";
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

registerServiceFactory("web", () => ({
  web: { fetch: (url, signal) => fetchUrl(url, { request: undiciRequester, signal }) },
}));

registerServiceFactory("memories", (p) => {
  if ((p.kind ?? "CHAT") !== "CHAT") return {};
  return {
    memories: {
      add: async (content) => {
        const m = await addMemory(p.userId, content, { source: "AGENT", threadId: p.threadId });
        return { id: m.id, content: m.content };
      },
      remove: async (id) => {
        const m = await deleteMemory(p.userId, id);
        return m ? { content: m.content } : null;
      },
    },
  };
});

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

registerServiceFactory("subagents", (p) => {
  if ((p.kind ?? "CHAT") !== "CHAT") return {};
  return {
    tasks: subagents().toolApi({
      runId: p.runId,
      threadId: p.threadId,
      rootThreadId: p.rootThreadId ?? p.threadId,
      userId: p.userId,
      messageId: p.messageId,
      modelId: p.modelId,
      webSearch: p.meta?.webSearch === true,
    }),
  };
});

registerWatcherFactory((p) => ((p.kind ?? "CHAT") === "CHAT" ? subagents().watcher(p.runId) : null));

registerSettledHook("subagents", (r) => subagents().handleRunSettled(r));
