import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { notFound } from "@/server/auth/errors";
import { subagents } from "@/server/subagents";
import { serializeTask } from "@/server/agent/serialize";
import { handler, json } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** User cancels one sub-agent. The parent agent is notified (not marked as already known). */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const task = await db.subagentTask.findFirst({ where: { id, userId: user.id } });
  if (!task) throw notFound("Task");
  if (task.status === "RUNNING") await subagents().cancel(id, "Cancelled by the user.", { notified: false });
  const fresh = await db.subagentTask.findUniqueOrThrow({ where: { id } });
  return json({ task: serializeTask(fresh) });
});
