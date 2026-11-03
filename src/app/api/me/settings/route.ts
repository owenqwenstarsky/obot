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
      select: {
        webSearchDefault: true,
        defaultModelId: true,
        defaultEffort: true,
        aboutMe: true,
        responseStyle: true,
        memoryEnabled: true,
        _count: { select: { memories: true } },
      },
    }),
    getSettings(),
  ]);
  const { _count, ...rest } = prefs;
  return json({
    ...rest,
    memoryCount: _count.memories,
    instanceWebSearchDefault: settings.webSearchDefault,
    instanceMemoryEnabled: settings.memoryEnabled,
  });
});

const schema = z.object({
  webSearchDefault: z.boolean().nullable().optional(),
  defaultModelId: z.string().max(200).nullable().optional(),
  defaultEffort: z.string().max(20).nullable().optional(),
  name: z.string().trim().min(1).max(100).optional(),
  aboutMe: z.string().max(4000).nullable().optional(),
  responseStyle: z.string().max(4000).nullable().optional(),
  memoryEnabled: z.boolean().optional(),
});

export const PATCH = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = await parseBody(req, schema);
  for (const k of ["aboutMe", "responseStyle"] as const) {
    if (body[k] !== undefined) body[k] = body[k]?.trim() ? body[k]!.trim() : null;
  }
  const updated = await db.user.update({
    where: { id: user.id },
    data: body,
    select: {
      webSearchDefault: true,
      defaultModelId: true,
      defaultEffort: true,
      name: true,
      aboutMe: true,
      responseStyle: true,
      memoryEnabled: true,
    },
  });
  return json(updated);
});
