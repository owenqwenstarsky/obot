import { requireAdmin } from "@/server/auth/session";
import { syncModels } from "@/server/llm/models";
import { HttpError } from "@/server/auth/errors";
import { handler, json } from "@/server/http";

export const POST = handler(async (req: Request) => {
  await requireAdmin(req);
  const res = await syncModels();
  if (!res.ok) throw new HttpError(502, `Couldn't load models from CLIProxyAPI: ${res.error}`, "SYNC_FAILED");
  return json(res);
});
