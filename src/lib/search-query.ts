/**
 * Search helpers shared by the server query and the palette UI (pure).
 */

/** Marks around matched words in snippets (private-use code points, never in normal text). */
export const HIGHLIGHT_START = "";
export const HIGHLIGHT_END = "";

/**
 * Turn free text into a prefix-matching Postgres tsquery: `rust async` → `rust:* & async:*`.
 * Only letters and digits survive, so the result is always valid tsquery syntax. Null when empty.
 */
export function buildPrefixTsQuery(input: string, maxTerms = 8): string | null {
  const terms = (input.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, maxTerms);
  if (terms.length === 0) return null;
  return terms.map((t) => `${t}:*`).join(" & ");
}

export type SnippetSegment = { text: string; match: boolean };

/** Split a highlighted snippet into plain and matched segments for safe rendering. */
export function splitHighlights(snippet: string): SnippetSegment[] {
  const out: SnippetSegment[] = [];
  let rest = snippet;
  while (rest.length) {
    const start = rest.indexOf(HIGHLIGHT_START);
    if (start === -1) {
      out.push({ text: rest, match: false });
      break;
    }
    if (start > 0) out.push({ text: rest.slice(0, start), match: false });
    const end = rest.indexOf(HIGHLIGHT_END, start + 1);
    if (end === -1) {
      out.push({ text: rest.slice(start + 1), match: true });
      break;
    }
    out.push({ text: rest.slice(start + 1, end), match: true });
    rest = rest.slice(end + 1);
  }
  // Merge neighbours of the same kind.
  return out.reduce<SnippetSegment[]>((acc, s) => {
    if (!s.text) return acc;
    const last = acc.at(-1);
    if (last && last.match === s.match) last.text += s.text;
    else acc.push({ ...s });
    return acc;
  }, []);
}
