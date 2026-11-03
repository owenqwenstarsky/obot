import "server-only";
import { db } from "@/server/db";
import type { CurrentUser } from "@/server/auth/session";
import { buildPrefixTsQuery, HIGHLIGHT_END, HIGHLIGHT_START } from "@/lib/search-query";

export type SearchThreadHit = { id: string; title: string; lastMessageAt: string; projectName: string | null };
export type SearchMessageHit = {
  messageId: string;
  threadId: string;
  threadTitle: string;
  /** For sub-agent threads, the parent thread. */
  parentThreadId: string | null;
  role: "USER" | "ASSISTANT";
  snippet: string;
  createdAt: string;
};
export type SearchResults = { threads: SearchThreadHit[]; messages: SearchMessageHit[] };

const HEADLINE_OPTIONS = `StartSel=${HIGHLIGHT_START}, StopSel=${HIGHLIGHT_END}, MaxFragments=2, MaxWords=18, MinWords=6, FragmentDelimiter=" … "`;

type Row = {
  messageId: string;
  threadId: string;
  threadTitle: string;
  parentThreadId: string | null;
  role: "USER" | "ASSISTANT";
  snippet: string | null;
  createdAt: Date;
};

/** Full-text search over the user's messages (all branches) plus thread titles. */
export async function search(user: CurrentUser, query: string, limit = 20): Promise<SearchResults> {
  const q = query.trim().slice(0, 200);
  if (!q) return { threads: [], messages: [] };
  const tsq = buildPrefixTsQuery(q);

  const [threads, rows] = await Promise.all([
    db.thread.findMany({
      where: { userId: user.id, deletedAt: null, parentThreadId: null, title: { contains: q, mode: "insensitive" } },
      orderBy: { lastMessageAt: "desc" },
      take: 8,
      select: { id: true, title: true, lastMessageAt: true, project: { select: { name: true, deletedAt: true } } },
    }),
    tsq
      ? db.$queryRaw<Row[]>`
          SELECT m."id" AS "messageId", m."threadId", t."title" AS "threadTitle", t."parentThreadId", m."role",
                 ts_headline('simple', m."searchText", q.query, ${HEADLINE_OPTIONS}) AS "snippet",
                 m."createdAt"
          FROM "message" AS m
          JOIN "thread" AS t ON t."id" = m."threadId"
          CROSS JOIN to_tsquery('simple', ${tsq}) AS q(query)
          WHERE t."userId" = ${user.id}
            AND t."deletedAt" IS NULL
            AND to_tsvector('simple', coalesce(m."searchText", '')) @@ q.query
          ORDER BY ts_rank(to_tsvector('simple', coalesce(m."searchText", '')), q.query) DESC, m."createdAt" DESC
          LIMIT ${Math.max(1, Math.min(50, limit))}`
      : Promise.resolve([] as Row[]),
  ]);

  return {
    threads: threads.map((t) => ({
      id: t.id,
      title: t.title,
      lastMessageAt: t.lastMessageAt.toISOString(),
      projectName: t.project && !t.project.deletedAt ? t.project.name : null,
    })),
    messages: rows.map((r) => ({
      messageId: r.messageId,
      threadId: r.threadId,
      threadTitle: r.threadTitle,
      parentThreadId: r.parentThreadId,
      role: r.role,
      snippet: (r.snippet ?? "").replace(/\s+/g, " ").trim(),
      createdAt: new Date(r.createdAt).toISOString(),
    })),
  };
}
