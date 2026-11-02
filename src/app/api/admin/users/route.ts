import { requireAdmin } from "@/server/auth/session";
import { listUsersForAdmin } from "@/server/admin";
import { handler, json } from "@/server/http";

export const GET = handler(async (req: Request) => {
  await requireAdmin(req);
  return json({ users: await listUsersForAdmin() });
});
