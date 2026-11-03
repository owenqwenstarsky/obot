/** Slash-command helpers for the prompt library (pure). */

export const CURSOR_MARKER = "{{cursor}}";
export const MAX_COMMAND_LENGTH = 40;

export type SlashPrompt = { id: string; command: string; title: string; body: string; scope: "USER" | "INSTANCE" };

/** `My Command!` → `my-command`. Letters, digits, `-` and `_` only. */
export function normalizeCommand(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/^\/+/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_COMMAND_LENGTH);
}

/** The partial command being typed, when the whole input is `/word` (no spaces yet); otherwise null. */
export function slashQuery(text: string): string | null {
  const m = /^\/([^\s/]*)$/.exec(text);
  return m ? m[1].toLowerCase() : null;
}

/** Personal prompts shadow shared ones with the same command; best matches first. */
export function matchSlashCommands<T extends SlashPrompt>(query: string, prompts: T[], limit = 8): T[] {
  const byCommand = new Map<string, T>();
  for (const p of prompts) {
    const existing = byCommand.get(p.command);
    if (!existing || (existing.scope === "INSTANCE" && p.scope === "USER")) byCommand.set(p.command, p);
  }
  const q = query.toLowerCase();
  const scored: { p: T; score: number }[] = [];
  for (const p of byCommand.values()) {
    const title = p.title.toLowerCase();
    const score = !q
      ? 3
      : p.command === q
        ? 0
        : p.command.startsWith(q)
          ? 1
          : p.command.includes(q)
            ? 2
            : title.includes(q)
              ? 3
              : -1;
    if (score >= 0) scored.push({ p, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.p.command.localeCompare(b.p.command))
    .slice(0, limit)
    .map((s) => s.p);
}

/** Text to insert for a prompt and where the caret goes (`{{cursor}}`, else the end). */
export function expandPrompt(body: string): { text: string; cursor: number } {
  const at = body.indexOf(CURSOR_MARKER);
  if (at === -1) return { text: body, cursor: body.length };
  const text = body.slice(0, at) + body.slice(at + CURSOR_MARKER.length).split(CURSOR_MARKER).join("");
  return { text, cursor: at };
}
