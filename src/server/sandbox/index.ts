import "server-only";
import path from "node:path";
import { env } from "@/config/env";
import { getSettings } from "@/server/settings";
import { SandboxService } from "@/server/sandbox/sandbox";

const g = globalThis as unknown as { __obotSandbox?: SandboxService };

export function sandboxes(): SandboxService {
  if (!g.__obotSandbox) {
    g.__obotSandbox = new SandboxService({
      dir: path.join(path.resolve(/*turbopackIgnore: true*/ env().UPLOAD_DIR), "sandboxes"),
      python: async () => (await getSettings()).sandboxPythonEnabled,
    });
  }
  return g.__obotSandbox;
}
