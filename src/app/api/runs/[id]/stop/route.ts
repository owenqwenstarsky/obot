import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { notFound } from "@/server/auth/errors";
import { runs } from "@/server/agent/runtime";
import { handler, json } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const run = await db.run.findFirst({ where: { id, userId: user.id }, select: { id: true } });
  if (!run) throw notFound("Run");
  return json({ stopped: runs().stop(id) });
});
