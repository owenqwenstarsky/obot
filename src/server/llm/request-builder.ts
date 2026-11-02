/**
 * Builds Responses API request bodies from thread history. Pure: image bytes are
 * resolved by the caller and passed in as data URLs.
 */
import type { MessagePart } from "@/lib/parts";
import { partsToText } from "@/lib/parts";
import type { AllowedEffort } from "@/lib/efforts";

export type HistoryMessage = {
  role: "USER" | "ASSISTANT";
  parts: MessagePart[];
};

export type ImageResolver = (attachmentId: string) => string | null;

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
  webSearch: WebSearchConfig;
  systemPrompt?: string | null;
  supportsReasoning: boolean;
};

export type InputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "auto" };

export type InputItem =
  | { role: "user"; content: InputContent[] }
  | { role: "assistant"; content: string };

export type ResponsesRequestBody = {
  model: string;
  input: InputItem[];
  instructions?: string;
  reasoning?: { effort: AllowedEffort; summary?: "auto" };
  tools?: Array<{
    type: "web_search";
    search_context_size: "low" | "medium" | "high";
    filters?: { allowed_domains: string[] };
  }>;
  include?: string[];
  stream: true;
  store: false;
};

export function buildInput(history: HistoryMessage[], resolveImage: ImageResolver): InputItem[] {
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
      }
      if (content.length > 0) items.push({ role: "user", content });
    } else {
      const text = partsToText(msg.parts).trim();
      if (text) items.push({ role: "assistant", content: text });
    }
  }
  return items;
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
    input: buildInput(args.history, args.resolveImage),
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
  return body;
}
