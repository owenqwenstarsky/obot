import { z } from "zod";
import { db } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { notFound } from "@/server/auth/errors";
import { handler, json, parseBody } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  enabled: z.boolean().optional(),
  displayNameOverride: z.string().trim().max(100).nullable().optional(),
  contextWindowOverride: z.number().int().positive().max(100_000_000).nullable().optional(),
  sortOrder: z.number().int().min(-10_000).max(10_000).optional(),
});

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  const exists = await db.model.findUnique({ where: { id: decodeURIComponent(id) } });
  if (!exists) throw notFound("Model");
  const model = await db.model.update({
    where: { id: exists.id },
    data: { ...body, displayNameOverride: body.displayNameOverride === "" ? null : body.displayNameOverride },
  });
  return json({ model });
});
