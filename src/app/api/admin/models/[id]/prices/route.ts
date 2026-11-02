import { z } from "zod";
import { db } from "@/server/db";
import { requireAdmin } from "@/server/auth/session";
import { notFound } from "@/server/auth/errors";
import { dollarsToMicros } from "@/lib/money";
import { handler, json, parseBody } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const prices = await db.modelPrice.findMany({
    where: { modelId: decodeURIComponent(id) },
    orderBy: { effectiveFrom: "desc" },
    include: { createdBy: { select: { email: true } } },
  });
  return json({
    prices: prices.map((p) => ({
      id: p.id,
      effectiveFrom: p.effectiveFrom.toISOString(),
      inputPerMMicros: Number(p.inputPerMMicros),
      cachedInputPerMMicros: Number(p.cachedInputPerMMicros),
      cacheWritePerMMicros: p.cacheWritePerMMicros != null ? Number(p.cacheWritePerMMicros) : null,
      outputPerMMicros: Number(p.outputPerMMicros),
      webSearchPer1kMicros: Number(p.webSearchPer1kMicros),
      longContextThreshold: p.longContextThreshold,
      longContextInputMult: p.longContextInputMult,
      longContextOutputMult: p.longContextOutputMult,
      createdBy: p.createdBy?.email ?? null,
    })),
  });
});

const dollars = z.number().nonnegative().max(100_000);
const schema = z.object({
  input: dollars,
  cachedInput: dollars,
  cacheWrite: dollars.nullable(),
  output: dollars,
  webSearchPer1k: dollars.default(0),
  longContextThreshold: z.number().int().positive().nullable(),
  longContextInputMult: z.number().min(1).max(100).nullable(),
  longContextOutputMult: z.number().min(1).max(100).nullable(),
});

/** Prices are append-only: saving creates a new row effective immediately. */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const actor = await requireAdmin(req);
  const { id } = await ctx.params;
  const modelId = decodeURIComponent(id);
  const body = await parseBody(req, schema);
  const model = await db.model.findUnique({ where: { id: modelId } });
  if (!model) throw notFound("Model");
  const price = await db.modelPrice.create({
    data: {
      modelId,
      inputPerMMicros: dollarsToMicros(body.input),
      cachedInputPerMMicros: dollarsToMicros(body.cachedInput),
      cacheWritePerMMicros: body.cacheWrite == null ? null : dollarsToMicros(body.cacheWrite),
      outputPerMMicros: dollarsToMicros(body.output),
      webSearchPer1kMicros: dollarsToMicros(body.webSearchPer1k),
      longContextThreshold: body.longContextThreshold,
      longContextInputMult: body.longContextInputMult,
      longContextOutputMult: body.longContextOutputMult,
      createdById: actor.id,
    },
  });
  return json({ id: price.id });
});
