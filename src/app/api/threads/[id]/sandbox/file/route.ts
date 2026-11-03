import path from "node:path";
import { requireUser } from "@/server/auth/session";
import { badRequest, notFound } from "@/server/auth/errors";
import { getOwnedThread } from "@/server/agent/turns";
import { sandboxes } from "@/server/sandbox";
import { handler } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** Download one sandbox file. Always served as an attachment so it never renders in-origin. */
export const GET = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const filePath = new URL(req.url).searchParams.get("path");
  if (!filePath) throw badRequest("Missing path.");
  const thread = await getOwnedThread(user, id);
  const bytes = await sandboxes().read(thread.parentThreadId ?? thread.id, filePath);
  if (!bytes) throw notFound("File");
  const name = path.posix.basename(filePath).replace(/[^\w.\- ]+/g, "_") || "file";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(path.posix.basename(filePath))}`,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
});
