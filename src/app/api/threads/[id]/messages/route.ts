import { requireUser } from "@/server/auth/session";
import { sendMessage } from "@/server/agent/turns";
import { sendSchema } from "@/server/agent/schemas";
import { handler, json, parseBody } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = await parseBody(req, sendSchema);
  return json(await sendMessage(user, { ...body, threadId: id }));
});
