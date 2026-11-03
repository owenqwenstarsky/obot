import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { deletePrompt, updatePrompt } from "@/server/prompts";
import { handler, json, parseBody } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  command: z.string().min(1).max(60).optional(),
  title: z.string().max(100).nullish(),
  body: z.string().min(1).max(20_000).optional(),
});

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  return json({ prompt: await updatePrompt(user, id, body) });
});

export const DELETE = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await deletePrompt(user, id);
  return json({ ok: true });
});
