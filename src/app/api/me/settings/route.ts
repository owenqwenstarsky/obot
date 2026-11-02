import { z } from "zod";
import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { getSettings } from "@/server/settings";
import { handler, json, parseBody } from "@/server/http";

export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const [prefs, settings] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { webSearchDefault: true, defaultModelId: true, defaultEffort: true },
    }),
    getSettings(),
  ]);
  return json({ ...prefs, instanceWebSearchDefault: settings.webSearchDefault });
});

const schema = z.object({
  webSearchDefault: z.boolean().nullable().optional(),
  defaultModelId: z.string().max(200).nullable().optional(),
  defaultEffort: z.string().max(20).nullable().optional(),
  name: z.string().trim().min(1).max(100).optional(),
});

export const PATCH = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = await parseBody(req, schema);
  const updated = await db.user.update({
    where: { id: user.id },
    data: body,
    select: { webSearchDefault: true, defaultModelId: true, defaultEffort: true, name: true },
  });
  return json(updated);
});
