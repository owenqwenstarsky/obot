import { z } from "zod";
import { db } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { badRequest } from "@/server/auth/errors";
import { handler, json, parseBody } from "@/server/http";

async function list() {
  const rows = await db.subagentModel.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return rows.map((r) => ({ modelId: r.modelId, description: r.description, defaultEffort: r.defaultEffort }));
}

export const GET = handler(async (req: Request) => {
  await requireAdmin(req);
  return json({ models: await list() });
});

const schema = z.object({
  models: z
    .array(
      z.object({
        modelId: z.string().min(1).max(200),
        description: z.string().trim().max(500).nullable().optional(),
        defaultEffort: z.string().max(20).nullable().optional(),
      }),
    )
    .max(50),
});

/** Replace the sub-agent model allowlist (order = preference order). */
export const PUT = handler(async (req: Request) => {
  await requireAdmin(req);
  const { models } = await parseBody(req, schema);
  const ids = models.map((m) => m.modelId);
  if (new Set(ids).size !== ids.length) throw badRequest("Each model can only be listed once.");
  const known = await db.model.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (known.length !== ids.length) throw badRequest("One or more models don't exist.");
  await db.$transaction([
    db.subagentModel.deleteMany({ where: { modelId: { notIn: ids } } }),
    ...models.map((m, i) =>
      db.subagentModel.upsert({
        where: { modelId: m.modelId },
        create: { modelId: m.modelId, description: m.description || null, defaultEffort: m.defaultEffort || null, sortOrder: i },
        update: { description: m.description || null, defaultEffort: m.defaultEffort || null, sortOrder: i },
      }),
    ),
  ]);
  return json({ models: await list() });
});
