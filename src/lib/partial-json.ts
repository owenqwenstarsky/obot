/**
 * Best-effort extraction of a top-level string field from (possibly incomplete) streamed JSON
 * tool arguments, e.g. to show an artifact's title or a command while it is still streaming.
 */
export function partialJsonString(json: string, key: string): string | null {
  const re = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*"`);
  const m = re.exec(json);
  if (!m) return null;
  let i = m.index + m[0].length;
  let out = "";
  while (i < json.length) {
    const ch = json[i];
    if (ch === '"') return out;
    if (ch === "\\") {
      const next = json[i + 1];
      if (next === undefined) break;
      if (next === "u") {
        const hex = json.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      out += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next === "b" ? "\b" : next === "f" ? "\f" : next;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
