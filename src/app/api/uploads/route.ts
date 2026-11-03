import { requireUser } from "@/server/auth/session";
import { badRequest } from "@/server/auth/errors";
import { saveUpload } from "@/server/uploads/storage";
import { handler, json } from "@/server/http";
import { serializeAttachment } from "@/server/agent/serialize";

export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Attach a file.");
  const att = await saveUpload(user.id, file);
  return json({ attachment: serializeAttachment(att) });
});
