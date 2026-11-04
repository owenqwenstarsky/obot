import { requireUser } from "@/server/auth/session";
import { getLimitStatus } from "@/server/billing/usage";
import { spendAlertLevel } from "@/server/billing/limits";
import { handler, json } from "@/server/http";

export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const s = await getLimitStatus(user.id);
  return json({
    unlimited: s.limits.unlimited,
    source: s.limits.source,
    weekly: {
      ...s.weekly,
      resetsAt: s.weekly.resetsAt.toISOString(),
      alert: spendAlertLevel(s.weekly.spentMicros, s.weekly.limitMicros),
    },
    monthly: {
      ...s.monthly,
      resetsAt: s.monthly.resetsAt.toISOString(),
      alert: spendAlertLevel(s.monthly.spentMicros, s.monthly.limitMicros),
    },
  });
});
