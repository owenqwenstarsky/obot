import { db } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { notFound } from "@/server/auth/errors";
import { readAttachmentBytes } from "@/server/uploads/storage";
import { handler } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const att = await db.attachment.findFirst({ where: { id, userId: user.id } });
  if (!att) throw notFound("Attachment");
  const bytes = await readAttachmentBytes(att.path).catch(() => null);
  if (!bytes) throw notFound("Attachment");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": att.mime,
      "content-length": String(bytes.byteLength),
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
});
