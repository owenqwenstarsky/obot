import { notFound } from "@/server/auth/errors";
import { sharedAttachment } from "@/server/shares";
import { attachmentResponse } from "@/server/uploads/storage";
import { handler } from "@/server/http";

type Ctx = { params: Promise<{ token: string; attachmentId: string }> };

/** Public: serves only attachments referenced by an active share. */
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const { token, attachmentId } = await ctx.params;
  const att = await sharedAttachment(token, attachmentId);
  if (!att) throw notFound("Attachment");
  // Not cacheable by shared caches: revoking a link must take effect.
  return attachmentResponse(att, "private, no-store");
});
