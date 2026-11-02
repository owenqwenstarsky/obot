import { requireUser } from "@/server/auth/session";
import { editMessage } from "@/server/agent/turns";
import { editSchema } from "@/server/agent/schemas";
import { handler, json, parseBody } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = await parseBody(req, editSchema);
  return json(await editMessage(user, id, body));
});
