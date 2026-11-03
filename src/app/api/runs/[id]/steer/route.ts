import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { notFound } from "@/server/auth/errors";
import { runs } from "@/server/agent/runtime";
import { handler, json, parseBody } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ text: z.string().trim().min(1, "Write a message first.").max(200_000) });

/**
 * Queue a steering message into a live run. Returns `accepted: false` if the run already
 * finished (or is finishing); the client then sends it as a normal message.
 */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const { text } = await parseBody(req, schema);
  const live = runs().get(id);
  if (live) {
    if (live.userId !== user.id) throw notFound("Run");
  } else {
    const run = await db.run.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!run) throw notFound("Run");
    return json({ accepted: false });
  }
  const steer = { id: randomUUID(), text, at: Date.now() };
  const { accepted } = runs().steer(id, steer);
  return json({ accepted, steer: accepted ? steer : null });
});
