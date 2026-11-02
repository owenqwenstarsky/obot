import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { deleteThread, getThreadDetail, updateThread } from "@/server/agent/threads";
import { handler, json, parseBody } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  return json({ thread: await getThreadDetail(user, id) });
});

const patchSchema = z.object({
  title: z.string().max(120).optional(),
  pinned: z.boolean().optional(),
  webSearchEnabled: z.boolean().optional(),
});

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  return json({ thread: await updateThread(user, id, body) });
});

export const DELETE = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await deleteThread(user, id);
  return json({ ok: true });
});
