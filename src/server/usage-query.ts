import "server-only";
import { badRequest } from "@/server/auth/errors";
import { safeTimeZone } from "@/server/billing/usage";

function parseDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`Invalid date: ${v}`);
  return d;
}

export function parseUsageQuery(url: URL) {
  const from = parseDate(url.searchParams.get("from"));
  const to = parseDate(url.searchParams.get("to"));
  if (from && to && from > to) throw badRequest("The start date must be before the end date.");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") ?? "50") || 50));
  return {
    from,
    to,
    timeZone: safeTimeZone(url.searchParams.get("tz")),
    page,
    pageSize,
    userId: url.searchParams.get("userId"),
  };
}

export { usageCsv } from "@/server/usage-csv";
