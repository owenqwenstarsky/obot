import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { notFound } from "@/server/auth/errors";
import { attachmentResponse } from "@/server/uploads/storage";
import { handler } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const att = await db.attachment.findFirst({ where: { id, userId: user.id } });
  if (!att) throw notFound("Attachment");
  return attachmentResponse(att, "private, max-age=31536000, immutable");
});
