/** Citation helpers (pure). */
import type { Citation } from "./parts";

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Strip OpenAI's utm_source tracking param so URLs compare equal to the cited ones. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("utm_source");
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

/**
 * Ensure every citation is visible inline. Most cited spans already contain a markdown
 * link to the URL; for those that don't, insert a compact `([host](url))` link at the
 * end of the cited span.
 */
export function injectCitationLinks(text: string, citations: Citation[]): string {
  if (citations.length === 0) return text;
  const inserts: { at: number; snippet: string }[] = [];
  for (const c of citations) {
    const start = Math.max(0, Math.min(c.start, text.length));
    const end = Math.max(start, Math.min(c.end, text.length));
    const span = text.slice(start, end);
    const canon = canonicalUrl(c.url);
    if (span.includes(c.url) || span.includes(canon)) continue;
    if (text.includes(`](${c.url}`) || text.includes(`](${canon}`)) continue;
    inserts.push({ at: end, snippet: ` ([${hostOf(c.url)}](${c.url}))` });
  }
  inserts.sort((a, b) => b.at - a.at);
  let out = text;
  const done = new Set<string>();
  for (const ins of inserts) {
    const key = `${ins.at}:${ins.snippet}`;
    if (done.has(key)) continue;
    done.add(key);
    out = out.slice(0, ins.at) + ins.snippet + out.slice(ins.at);
  }
  return out;
}

/**
 * Models usually wrap citations as `([host](url))`. Since cited links render as chips,
 * drop the surrounding parentheses so the text doesn't read "( chip )".
 */
export function stripCitationParens(text: string, citations: Citation[]): string {
  if (citations.length === 0) return text;
  const cited = new Set(citations.map((c) => canonicalUrl(c.url)));
  return text.replace(/\(\s*(\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\))\s*\)/g, (match, link: string, url: string) =>
    cited.has(canonicalUrl(url)) ? link : match,
  );
}

/** Unique cited sources in order of first appearance. */
export function uniqueSources(citations: Citation[]): { url: string; title?: string }[] {
  const seen = new Set<string>();
  const out: { url: string; title?: string }[] = [];
  for (const c of [...citations].sort((a, b) => a.start - b.start)) {
    const key = canonicalUrl(c.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: c.url, title: c.title });
  }
  return out;
}
