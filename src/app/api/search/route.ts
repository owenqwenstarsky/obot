import { requireUser } from "@/server/auth/session";
import { search } from "@/server/search";
import { handler, json } from "@/server/http";

export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return json(await search(user, q));
});
