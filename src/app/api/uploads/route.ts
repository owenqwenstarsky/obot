import { requireUser } from "@/server/auth/session";
import { badRequest } from "@/server/auth/errors";
import { saveImage } from "@/server/uploads/storage";
import { handler, json } from "@/server/http";

export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Attach an image file.");
  const att = await saveImage(user.id, file);
  return json({ attachment: { id: att.id, mime: att.mime, size: att.size, fileName: att.fileName } });
});
