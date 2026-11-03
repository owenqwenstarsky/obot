import { requireUser } from "@/server/auth/session";
import { revokeShare } from "@/server/shares";
import { handler, json } from "@/server/http";

type Ctx = { params: Promise<{ id: string; shareId: string }> };

export const DELETE = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id, shareId } = await ctx.params;
  await revokeShare(user, id, shareId);
  return json({ ok: true });
});
