import "server-only";
import { getUsageRecords, getUsageReport } from "@/server/billing/usage";
import { parseUsageQuery, usageCsv } from "@/server/usage-query";
import { json } from "@/server/http";

/** Shared implementations for /api/me/usage* and /api/admin/usage*. `userId` is already authorized. */
export async function usageReportResponse(url: URL, userId: string | null) {
  const q = parseUsageQuery(url);
  return json(await getUsageReport({ ...q, userId }));
}

export async function usageRecordsResponse(url: URL, userId: string | null) {
  const q = parseUsageQuery(url);
  const res = await getUsageRecords({ ...q, userId });
  return json({ ...res, page: q.page, pageSize: q.pageSize });
}

export async function usageExportResponse(url: URL, userId: string | null) {
  const q = parseUsageQuery(url);
  const rows = [];
  const pageSize = 1000;
  for (let page = 1; ; page++) {
    const res = await getUsageRecords({ ...q, userId, page, pageSize });
    rows.push(...res.rows);
    if (res.rows.length < pageSize || rows.length >= 1_000_000) break;
  }
  return new Response(usageCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="obot-usage-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
