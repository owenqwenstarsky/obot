import { requireUser } from "@/server/auth/session";
import { getOwnedThread } from "@/server/agent/turns";
import { sandboxes } from "@/server/sandbox";
import { handler, json } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** Files in the thread's sandbox (sub-agent threads resolve to their parent's sandbox). */
export const GET = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const thread = await getOwnedThread(user, id);
  const rootId = thread.parentThreadId ?? thread.id;
  const entries = await sandboxes().list(rootId);
  return json({ entries });
});
