import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { deleteProject, getProjectDetail, updateProject } from "@/server/projects";
import { handler, json, parseBody } from "@/server/http";
import { projectFields } from "@/server/projects-schema";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  return json({ project: await getProjectDetail(user, id) });
});

const patchSchema = z.object({ name: z.string().min(1).max(100).optional(), ...projectFields });

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  return json({ project: await updateProject(user, id, body) });
});

export const DELETE = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await deleteProject(user, id);
  return json({ ok: true });
});
