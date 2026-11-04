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

/**
 * OpenAI models sometimes write their internal citation markers verbatim, e.g.
 * `citeturn3search4turn3news1`. Chat text arrives with these already
 * resolved, but tool-call arguments (e.g. an artifact's content) don't.
 */
const CITATION_MARKER = /[^]*/g;
/** The same marker as it appears JSON-escaped inside raw tool arguments. */
const ESCAPED_CITATION_MARKER = /\\u[eE]200(?:(?!\\u[eE]201)[\s\S])*\\u[eE]201/g;
/** Stray private-use citation delimiters left behind (unterminated markers). */
const CITATION_DELIMITERS = /[-]/g;

/** Remove citation markers (and any stray delimiters) from text. */
export function stripCitationMarkers(text: string): string {
  if (!/[-]/.test(text)) return text;
  return text.replace(CITATION_MARKER, "").replace(CITATION_DELIMITERS, "");
}

/** Markdown link with parentheses in the URL encoded so `(...)` wrapping stays valid. */
function citationLink(url: string): string {
  const safe = url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20");
  return `[${hostOf(url)}](${safe})`;
}

/**
 * Resolve citation markers inside raw (JSON) tool arguments. `citations` are url_citation
 * annotations whose offsets point at marker spans in `args`; each marker becomes a compact
 * ` ([host](url))` link (JSON-escaped, so the arguments stay valid JSON). Markers without a
 * matching annotation are removed.
 */
export function resolveArgCitations(args: string, citations: Citation[]): string {
  const bySpan = new Map<string, { start: number; end: number; urls: string[] }>();
  for (const c of citations) {
    if (c.start < 0 || c.end > args.length || c.end <= c.start) continue;
    const span = args.slice(c.start, c.end);
    if (!/^[^]*$/.test(span)) continue;
    const key = `${c.start}:${c.end}`;
    const entry = bySpan.get(key) ?? { start: c.start, end: c.end, urls: [] };
    if (!entry.urls.some((u) => canonicalUrl(u) === canonicalUrl(c.url))) entry.urls.push(c.url);
    bySpan.set(key, entry);
  }
  let out = args;
  // Replace from the end so earlier offsets stay valid; skip overlapping spans.
  let limit = Infinity;
  for (const s of [...bySpan.values()].sort((a, b) => b.start - a.start)) {
    if (s.end > limit) continue;
    const links = ` (${s.urls.map(citationLink).join(", ")})`;
    out = out.slice(0, s.start) + JSON.stringify(links).slice(1, -1) + out.slice(s.end);
    limit = s.start;
  }
  return stripCitationMarkers(out.replace(ESCAPED_CITATION_MARKER, ""));
}
