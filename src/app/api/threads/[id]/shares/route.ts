import { requireUser } from "@/server/auth/session";
import { createShare, listShares } from "@/server/shares";
import { handler, json } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  return json({ shares: await listShares(user, id) });
});

/** Create a link to a frozen copy of the conversation as it looks now. The URL is only returned once. */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  return json(await createShare(user, id));
});
