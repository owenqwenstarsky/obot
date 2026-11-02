import { requireUser } from "@/server/auth/session";
import { sendMessage } from "@/server/agent/turns";
import { sendSchema } from "@/server/agent/schemas";
import { handler, json, parseBody } from "@/server/http";

/** Start a brand-new thread with its first message. */
export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = await parseBody(req, sendSchema);
  return json(await sendMessage(user, { ...body, threadId: null }));
});
