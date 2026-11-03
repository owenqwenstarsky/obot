import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { notFound } from "@/server/auth/errors";
import { deleteMemory, MAX_MEMORY_CHARS, serializeMemory, updateMemory } from "@/server/memories";
import { handler, json, parseBody } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({ content: z.string().min(1).max(MAX_MEMORY_CHARS) });

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const { content } = await parseBody(req, patchSchema);
  return json({ memory: serializeMemory(await updateMemory(user.id, id, content)) });
});

export const DELETE = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  if (!(await deleteMemory(user.id, id))) throw notFound("Memory");
  return json({ ok: true });
});
