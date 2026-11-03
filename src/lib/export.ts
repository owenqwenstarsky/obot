/** Markdown export of a conversation (pure). */
import { injectCitationLinks, uniqueSources } from "@/lib/citations";
import type { Citation, MessagePart } from "@/lib/parts";

export type ExportMessage = {
  role: "USER" | "ASSISTANT";
  parts: MessagePart[];
  modelId: string | null;
  createdAt: string | Date;
};

const iso = (d: string | Date) => (typeof d === "string" ? d : d.toISOString());

function toolSummary(p: Extract<MessagePart, { type: "tool" }>): string | null {
  if (p.tool === "web_search") {
    const queries = p.actions.flatMap((a) => (a.kind === "search" ? a.queries : []));
    return queries.length ? `Searched the web: ${queries.map((q) => `“${q}”`).join(", ")}` : "Searched the web";
  }
  if (p.tool === "generic") return null;
  const d = p.display;
  switch (d?.kind) {
    case "bash":
      return `Ran \`${d.command.split("\n")[0].slice(0, 120)}\` (exit ${d.exitCode})`;
    case "write_file":
      return `Wrote ${d.path}`;
    case "artifact":
      return `${p.name === "update_artifact" ? "Updated" : "Created"} artifact “${d.title}” (v${d.version})`;
    case "subagent":
      return `Delegated “${d.title}” to a sub-agent`;
    case "fetch":
      return `Read ${d.title ? `“${d.title}” ` : ""}<${d.finalUrl}>`;
    case "memory":
      return `${d.action === "saved" ? "Saved to memory" : "Forgot"}: ${d.content}`;
    default:
      return p.status === "failed" ? `Tool ${p.name} failed` : `Used ${p.name.replace(/_/g, " ")}`;
  }
}

export function threadToMarkdown(
  title: string,
  messages: ExportMessage[],
  opts: { modelName?: (id: string) => string | null; exportedAt?: Date } = {},
): string {
  const out: string[] = [`# ${title.replace(/\n/g, " ")}`, "", `_Exported from Obot on ${iso(opts.exportedAt ?? new Date()).slice(0, 10)}_`];
  for (const m of messages) {
    const parts: string[] = [];
    const citations: Citation[] = [];
    for (const p of m.parts) {
      switch (p.type) {
        case "user_text":
          parts.push(p.text);
          break;
        case "user_image":
          parts.push(`_[Image attached]_`);
          break;
        case "user_file":
          parts.push(`_[File attached: ${p.fileName}]_`);
          break;
        case "text":
          parts.push(injectCitationLinks(p.text, p.citations));
          citations.push(...p.citations);
          break;
        case "steer":
          parts.push(`> **You (while the agent worked):** ${p.text.replace(/\n/g, "\n> ")}`);
          break;
        case "tool": {
          const s = toolSummary(p);
          if (s) parts.push(`> _${s}_`);
          break;
        }
        case "error":
          parts.push(`> **Error:** ${p.message}`);
          break;
        default:
          break;
      }
    }
    if (parts.length === 0) continue;
    const who =
      m.role === "USER" ? "You" : `Assistant${m.modelId ? ` (${opts.modelName?.(m.modelId) ?? m.modelId})` : ""}`;
    out.push("", "---", "", `## ${who}`, "", parts.join("\n\n"));
    const sources = uniqueSources(citations);
    if (sources.length) {
      out.push("", "**Sources**", "", ...sources.map((s, i) => `${i + 1}. [${(s.title || s.url).replace(/[[\]]/g, "")}](${s.url})`));
    }
  }
  return `${out.join("\n").trim()}\n`;
}

