import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { updateUserAsAdmin } from "@/server/admin";
import { handler, json, parseBody } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

const money = z.number().nonnegative().max(1_000_000).nullable();
const schema = z.object({
  role: z.enum(["USER", "ADMIN"]).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  limitMode: z.enum(["INHERIT", "CUSTOM", "UNLIMITED"]).optional(),
  weeklyLimit: money.optional(),
  monthlyLimit: money.optional(),
});

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const actor = await requireAdmin(req);
  const { id } = await ctx.params;
  await updateUserAsAdmin(actor, id, await parseBody(req, schema));
  return json({ ok: true });
});
