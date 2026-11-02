import { z } from "zod";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { notFound } from "@/server/auth/errors";
import { getArtifactDetail } from "@/server/artifacts";
import { cleanTitle } from "@/server/artifacts/core";
import { handler, json, parseBody } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const v = Number(new URL(req.url).searchParams.get("version") ?? "") || null;
  const artifact = await getArtifactDetail(user.id, id, v);
  if (!artifact) throw notFound("Artifact");
  return json({ artifact });
});

const patchSchema = z.object({ title: z.string().trim().min(1).max(120) });

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const { title } = await parseBody(req, patchSchema);
  const res = await db.artifact.updateMany({ where: { id, userId: user.id, deletedAt: null }, data: { title: cleanTitle(title) } });
  if (res.count === 0) throw notFound("Artifact");
  return json({ artifact: await getArtifactDetail(user.id, id) });
});

export const DELETE = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const res = await db.artifact.updateMany({ where: { id, userId: user.id, deletedAt: null }, data: { deletedAt: new Date() } });
  if (res.count === 0) throw notFound("Artifact");
  return json({ ok: true });
});
