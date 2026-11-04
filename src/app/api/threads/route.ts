import { requireUser } from "@/server/auth/session";
import { listThreads } from "@/server/agent/threads";
import { handler, json } from "@/server/http";

export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const params = new URL(req.url).searchParams;
  return json({ threads: await listThreads(user, params.get("q"), { projectId: params.get("projectId") }) });
});
