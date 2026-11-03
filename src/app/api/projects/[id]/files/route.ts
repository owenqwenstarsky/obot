import { requireUser } from "@/server/auth/session";
import { badRequest } from "@/server/auth/errors";
import { addProjectFile, removeProjectFile } from "@/server/projects";
import { handler, json } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Attach a file.");
  return json({ file: await addProjectFile(user, id, file) });
});

export const DELETE = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const fileId = new URL(req.url).searchParams.get("fileId");
  if (!fileId) throw badRequest("Missing fileId.");
  await removeProjectFile(user, id, fileId);
  return json({ ok: true });
});
