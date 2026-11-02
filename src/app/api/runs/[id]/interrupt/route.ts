import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { notFound } from "@/server/auth/errors";
import { runs } from "@/server/agent/runtime";
import { handler, json } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ text: z.string().trim().max(200_000).optional() });

/**
 * Abort the current model call / tool batch only. Sub-agents keep running. If `text` is
 * given it is queued first so the agent continues with it immediately.
 */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  let body: z.infer<typeof schema> = {};
  try {
    body = schema.parse(await req.json());
  } catch {
    body = {};
  }
  const live = runs().get(id);
  if (!live || live.userId !== user.id) throw notFound("Run");
  let accepted = false;
  if (body.text) accepted = runs().steer(id, { id: randomUUID(), text: body.text, at: Date.now() }).accepted;
  const interrupted = runs().interrupt(id);
  return json({ interrupted, accepted });
});
