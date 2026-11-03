import { requireUser } from "@/server/auth/session";
import { listArtifacts } from "@/server/artifacts";
import { handler, json } from "@/server/http";

/** Batch status lookup for many artifacts at once (polled while some are generating). */
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
  if (ids.length === 0) return json({ artifacts: [] });
  return json({ artifacts: await listArtifacts(user.id, ids) });
});
