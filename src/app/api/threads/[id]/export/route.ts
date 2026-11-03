import { requireUser } from "@/server/auth/session";
import { getOwnedThread } from "@/server/agent/turns";
import { loadVisiblePath } from "@/server/shares";
import { getAllCatalogModels } from "@/server/llm/models";
import { buildShareSnapshot } from "@/lib/share";
import { threadToMarkdown } from "@/lib/export";
import { contentDisposition } from "@/server/uploads/document-type";
import { handler } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

function slug(title: string) {
  return (
    title
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60)
      .toLowerCase() || "thread"
  );
}

/** Download the visible conversation as Markdown (`?format=md`, default) or JSON (`?format=json`). */
export const GET = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const thread = await getOwnedThread(user, id);
  const path = await loadVisiblePath(thread.id, thread.currentLeafId);
  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "md";
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  const names = new Map((await getAllCatalogModels().catch(() => [])).map((m) => [m.id, m.displayName]));
  const modelName = (mid: string) => names.get(mid) ?? null;
  if (format === "json") {
    const body = JSON.stringify(buildShareSnapshot(thread.title, path, { modelName }), null, 2);
    return new Response(body, {
      headers: {
        ...headers,
        "content-type": "application/json; charset=utf-8",
        "content-disposition": contentDisposition("attachment", `${slug(thread.title)}.json`),
      },
    });
  }
  const md = threadToMarkdown(thread.title, path, { modelName });
  return new Response(md, {
    headers: {
      ...headers,
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": contentDisposition("attachment", `${slug(thread.title)}.md`),
    },
  });
});
