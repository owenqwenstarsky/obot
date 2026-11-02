import { requireAdmin } from "@/server/auth/session";
import { revokeInvite } from "@/server/admin";
import { handler, json } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = handler(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  await revokeInvite(id);
  return json({ ok: true });
});
