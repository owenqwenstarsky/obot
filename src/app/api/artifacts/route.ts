import { requireUser } from "@/server/auth/session";
import { listArtifacts } from "@/server/artifacts";
import { handler, json } from "@/server/http";

export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  return json({ artifacts: await listArtifacts(user.id) });
});
