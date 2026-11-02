import { requireAdmin } from "@/server/auth/session";
import { usageReportResponse } from "@/server/usage-routes";
import { handler } from "@/server/http";

/** Admin view: all users, or a single user with ?userId=. */
export const GET = handler(async (req: Request) => {
  await requireAdmin(req);
  const url = new URL(req.url);
  return usageReportResponse(url, url.searchParams.get("userId") || null);
});
