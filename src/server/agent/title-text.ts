/** Pure helpers for thread titles. */

export function fallbackTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New thread";
  return clean.length > 60 ? `${clean.slice(0, 57).trimEnd()}…` : clean;
}

export function cleanTitle(raw: string): string {
  const t = raw
    .split("\n")[0]
    .replace(/^["'“”‘’`*#\s]+|["'“”‘’`*\s.]+$/g, "")
    .replace(/^title:\s*/i, "")
    .trim();
  return t.slice(0, 80);
}
