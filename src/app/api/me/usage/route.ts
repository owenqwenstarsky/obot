import { requireUser } from "@/server/auth/session";
import { usageReportResponse } from "@/server/usage-routes";
import { handler } from "@/server/http";

export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  return usageReportResponse(new URL(req.url), user.id);
});
