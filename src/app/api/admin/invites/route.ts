import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { createInvite, listInvites } from "@/server/admin";
import { handler, json, parseBody } from "@/server/http";

export const GET = handler(async (req: Request) => {
  await requireAdmin(req);
  return json({ invites: await listInvites() });
});

const schema = z.object({
  email: z.string().trim().email().nullish().or(z.literal("")),
  role: z.enum(["USER", "ADMIN"]).default("USER"),
  expiresInDays: z.number().int().min(1).max(90).default(7),
  note: z.string().max(200).nullish(),
});

export const POST = handler(async (req: Request) => {
  const actor = await requireAdmin(req);
  return json(await createInvite(actor, await parseBody(req, schema)));
});
