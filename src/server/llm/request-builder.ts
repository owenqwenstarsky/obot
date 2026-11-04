/**
 * Builds Responses API request bodies from thread history. Pure: image bytes are
 * resolved by the caller and passed in as data URLs.
 */
import type { MessagePart } from "@/lib/parts";
import type { AllowedEffort } from "@/lib/efforts";
import {
  isStoredTranscript,
  replayTranscript,
  truncateMiddle,
  type InputContent,
  type InputItem,
} from "@/server/llm/transcript";

export type { InputContent, InputItem } from "@/server/llm/transcript";

export type HistoryMessage = {
  role: "USER" | "ASSISTANT";
  parts: MessagePart[];
  /** Message.rawOutput; replayed when it is a v2 transcript. */
  transcript?: unknown;
};

export type FunctionToolSpec = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: false;
};

export type WebSearchToolSpec = {
  type: "web_search";
  search_context_size: "low" | "medium" | "high";
  filters?: { allowed_domains: string[] };
};

export type ImageResolver = (attachmentId: string) => string | null;

export type ResolvedDocument = { fileName: string; text: string };
export type DocumentResolver = (attachmentId: string) => ResolvedDocument | null;

/** Max characters of one document's text sent to the model (head + tail are kept). */
export const DOCUMENT_PROMPT_CHARS = 50_000;

export type WebSearchConfig = {
  enabled: boolean;
  contextSize: "low" | "medium" | "high";
  allowedDomains: string[];
};

export type BuildRequestArgs = {
  model: string;
  effort: AllowedEffort | null;
  history: HistoryMessage[];
  resolveImage: ImageResolver;
  resolveDocument?: DocumentResolver;
  webSearch: WebSearchConfig;
  systemPrompt?: string | null;
  supportsReasoning: boolean;
  /** Request encrypted reasoning so it can be replayed between tool calls (store: false). */
  replayReasoning?: boolean;
};

export type ResponsesRequestBody = {
  model: string;
  input: InputItem[];
  instructions?: string;
  reasoning?: { effort: AllowedEffort; summary?: "auto" };
  tools?: Array<WebSearchToolSpec | FunctionToolSpec>;
  tool_choice?: "auto" | "required" | { type: "function"; name: string };
  parallel_tool_calls?: boolean;
  include?: string[];
  stream: true;
  store: false;
};

const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/\n/g, " ");

/** The text block a document attachment becomes in the model input. Pure. */
export function documentInputText(
  part: { fileName: string; sandboxPath?: string; chars?: number },
  doc: ResolvedDocument | null,
): string {
  const attrs = [`name="${escapeAttr(part.fileName)}"`];
  if (part.sandboxPath) attrs.push(`sandbox_path="${escapeAttr(part.sandboxPath)}"`);
  if (!doc) return `<document ${attrs.join(" ")}>\n[This file was attached but is no longer available.]\n</document>`;
  const text = doc.text;
  if (!text.trim()) {
    return `<document ${attrs.join(" ")}>\n[No text could be extracted from this file (it may be scanned or image-only).]\n</document>`;
  }
  let body = text;
  let note = "";
  if (text.length > DOCUMENT_PROMPT_CHARS) {
    body = truncateMiddle(text, DOCUMENT_PROMPT_CHARS);
    attrs.push(`truncated="true"`, `total_chars="${text.length}"`);
    note = part.sandboxPath
      ? `\n[Only part of this file is shown. The full file is at ${part.sandboxPath} in the sandbox.]`
      : "\n[Only part of this file is shown.]";
  }
  return `<document ${attrs.join(" ")}>\n${body}${note}\n</document>`;
}

export function buildInput(
  history: HistoryMessage[],
  resolveImage: ImageResolver,
  resolveDocument: DocumentResolver = () => null,
): InputItem[] {
  const items: InputItem[] = [];
  for (const msg of history) {
    if (msg.role === "USER") {
      const content: InputContent[] = [];
      for (const p of msg.parts) {
        if (p.type === "user_text" && p.text.trim()) content.push({ type: "input_text", text: p.text });
        if (p.type === "user_image") {
          const url = resolveImage(p.attachmentId);
          if (url) content.push({ type: "input_image", image_url: url, detail: "auto" });
          else content.push({ type: "input_text", text: "[An image was attached here but is no longer available.]" });
        }
        if (p.type === "user_file") {
          content.push({ type: "input_text", text: documentInputText(p, resolveDocument(p.attachmentId)) });
        }
      }
      if (content.length > 0) items.push({ role: "user", content });
    } else if (isStoredTranscript(msg.transcript)) {
      items.push(...replayTranscript(msg.transcript.items, { pastTurn: true }));
    } else {
      items.push(...legacyAssistantItems(msg.parts));
    }
  }
  return items;
}

/** Text-only replay of an assistant message (legacy rows); steering parts become user items. */
function legacyAssistantItems(parts: MessagePart[]): InputItem[] {
  const out: InputItem[] = [];
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join("\n\n").trim();
    if (text) out.push({ role: "assistant", content: text });
    buf = [];
  };
  for (const p of parts) {
    if (p.type === "text" && p.text.trim()) buf.push(p.text);
    else if (p.type === "steer") {
      flush();
      out.push({ role: "user", content: [{ type: "input_text", text: p.text }] });
    }
  }
  flush();
  return out;
}

/** Normalize admin-entered domains: strip protocol, path, and whitespace; dedupe. */
export function normalizeDomains(domains: string[]): string[] {
  const out = new Set<string>();
  for (const raw of domains) {
    const d = raw
      .trim()
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, "")
      .replace(/\/.*$/, "");
    if (d) out.add(d);
  }
  return [...out].slice(0, 100);
}

export function buildResponsesRequest(args: BuildRequestArgs): ResponsesRequestBody {
  const body: ResponsesRequestBody = {
    model: args.model,
    input: buildInput(args.history, args.resolveImage, args.resolveDocument),
    stream: true,
    store: false,
  };
  const instructions = args.systemPrompt?.trim();
  if (instructions) body.instructions = instructions;

  if (args.supportsReasoning && args.effort) {
    body.reasoning = args.effort === "none" ? { effort: "none" } : { effort: args.effort, summary: "auto" };
  }

  if (args.webSearch.enabled) {
    const domains = normalizeDomains(args.webSearch.allowedDomains);
    body.tools = [
      {
        type: "web_search",
        search_context_size: args.webSearch.contextSize,
        ...(domains.length > 0 ? { filters: { allowed_domains: domains } } : {}),
      },
    ];
    body.include = ["web_search_call.action.sources"];
  }
  if (args.replayReasoning && args.supportsReasoning && args.effort && args.effort !== "none") {
    body.include = [...(body.include ?? []), "reasoning.encrypted_content"];
  }
  return body;
}
