import { requireUser } from "@/server/auth/session";
import { regenerateMessage } from "@/server/agent/turns";
import { turnOptionsSchema } from "@/server/agent/schemas";
import { handler, json, parseBody } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = await parseBody(req, turnOptionsSchema);
  return json(await regenerateMessage(user, id, body));
});
