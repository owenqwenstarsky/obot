import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { deleteThread, getThreadDetail, updateThread } from "@/server/agent/threads";
import { setCurrentLeaf } from "@/server/agent/turns";
import { serializeThread } from "@/server/agent/serialize";
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
  /** Switch the visible branch. */
  currentLeafId: z.string().min(1).max(64).optional(),
  /** Move into a project (or out with null). */
  projectId: z.string().max(64).nullable().optional(),
});

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const { currentLeafId, ...body } = await parseBody(req, patchSchema);
  if (currentLeafId) {
    const thread = await setCurrentLeaf(user, id, currentLeafId);
    if (Object.keys(body).length === 0) return json({ thread: serializeThread(thread) });
  }
  return json({ thread: await updateThread(user, id, body) });
});

export const DELETE = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await deleteThread(user, id);
  return json({ ok: true });
});
