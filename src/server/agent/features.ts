/**
 * Registers feature services/hooks with the runtime. Imported by turns.ts so registration
 * happens before any run starts.
 */
import "server-only";
import { registerServiceFactory, registerThreadDeleteHook } from "@/server/agent/runtime";
import { sandboxes } from "@/server/sandbox";

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
