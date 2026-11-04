/**
 * Fetch a public web page or document and convert it to readable text/markdown for the
 * agent. Redirects are followed manually so every hop is re-validated; the network layer is
 * injectable so this can be tested in memory.
 */
import { BlockedUrlError, assertFetchableUrl } from "@/server/web/ssrf";
import { decodeUtf8Text, isPdf } from "@/server/uploads/document-type";
import { extractPdfText } from "@/server/uploads/extract";

export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_REDIRECTS = 5;
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const USER_AGENT = "Obot/1.0 (+fetch_url; self-hosted AI assistant)";

export type RawResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  /** Release the connection early (body not fully read). */
  cancel?: () => void;
};

export type HttpRequester = (url: URL, opts: { signal: AbortSignal; headers: Record<string, string> }) => Promise<RawResponse>;

export type FetchedPage = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title: string | null;
  /** Markdown for HTML, raw text otherwise. */
  content: string;
  /** The body was larger than the size cap and was cut. */
  truncatedBody: boolean;
};

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

function header(headers: RawResponse["headers"], name: string): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

export type ContentClass = "html" | "text" | "pdf" | "unsupported";

/** Decide how to handle a response from its Content-Type (falling back to sniffing). Pure. */
export function classifyContent(contentType: string, head: Uint8Array): ContentClass {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  if (mime === "application/pdf") return "pdf";
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime.endsWith("+json") ||
    mime === "application/xml" ||
    mime.endsWith("+xml") ||
    mime === "application/javascript" ||
    mime === "application/x-yaml" ||
    mime === "application/yaml" ||
    mime === "application/toml" ||
    mime === "application/x-ndjson"
  ) {
    return "text";
  }
  if (!mime || mime === "application/octet-stream" || mime === "binary/octet-stream") {
    if (isPdf(head)) return "pdf";
    const sample = decodeUtf8Text(head.slice(0, 4096));
    if (sample != null) return /<html[\s>]|<!doctype html/i.test(sample) ? "html" : "text";
  }
  return "unsupported";
}

/** Charset from Content-Type, or from an HTML <meta> in the first bytes. Pure. */
export function detectCharset(contentType: string, head: Uint8Array, isHtml: boolean): string {
  const fromHeader = /charset\s*=\s*"?([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  if (isHtml) {
    const sample = new TextDecoder("latin1").decode(head.slice(0, 2048));
    const meta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(sample)?.[1];
    if (meta) return meta.toLowerCase();
  }
  return "utf-8";
}

export function decodeText(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** HTML → { title, markdown } using Readability for the main content and Turndown for markdown. */
export async function htmlToMarkdown(html: string, baseUrl: string): Promise<{ title: string | null; markdown: string }> {
  const [{ parseHTML }, { Readability }, { default: TurndownService }] = await Promise.all([
    import("linkedom"),
    import("@mozilla/readability"),
    import("turndown"),
  ]);
  const { document } = parseHTML(html);
  // Resolve relative links/images against the page URL so markdown links work.
  for (const el of Array.from(document.querySelectorAll("a[href], img[src]")) as Element[]) {
    const attr = el.tagName.toLowerCase() === "a" ? "href" : "src";
    const value = el.getAttribute(attr);
    if (!value) continue;
    try {
      el.setAttribute(attr, new URL(value, baseUrl).toString());
    } catch {
      // leave as-is
    }
  }
  const docTitle = document.querySelector("title")?.textContent?.trim() || null;
  let contentHtml: string | null = null;
  let title = docTitle;
  try {
    const article = new Readability(document.cloneNode(true) as unknown as Document, { charThreshold: 200 }).parse();
    if (article?.content && (article.textContent ?? "").trim().length > 0) {
      contentHtml = article.content;
      title = article.title?.trim() || docTitle;
    }
  } catch {
    // fall through to the body
  }
  if (!contentHtml) {
    for (const el of Array.from(document.querySelectorAll("script, style, noscript, template, svg, iframe")) as Element[]) el.remove();
    contentHtml = document.body?.innerHTML ?? html;
  }
  const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  turndown.remove(["script", "style", "noscript", "iframe", "form", "button"] as never);
  const markdown = turndown
    .turndown(contentHtml)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, markdown };
}

async function readBody(res: RawResponse, max: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for await (const chunk of res.body) {
    const room = max - total;
    if (chunk.byteLength > room) {
      chunks.push(chunk.subarray(0, room));
      total += room;
      truncated = true;
      res.cancel?.();
      break;
    }
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return { bytes: out, truncated };
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export async function fetchUrl(rawUrl: string, deps: { request: HttpRequester; signal?: AbortSignal }): Promise<FetchedPage> {
  const start = assertFetchableUrl(rawUrl);
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const signal = deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout;
  const headers = {
    "user-agent": USER_AGENT,
    accept: "text/html,application/xhtml+xml,text/plain,text/markdown,application/json,application/pdf;q=0.9,*/*;q=0.5",
    "accept-language": "en;q=0.9,*;q=0.5",
  };

  let url = start;
  let res: RawResponse | null = null;
  for (let hop = 0; ; hop++) {
    try {
      res = await deps.request(url, { signal, headers });
    } catch (err) {
      if (err instanceof BlockedUrlError || (err as { code?: string }).code === "EBLOCKED") {
        throw new BlockedUrlError((err as Error).message);
      }
      if (timeout.aborted) throw new FetchError(`Timed out after ${FETCH_TIMEOUT_MS / 1000}s.`);
      if (deps.signal?.aborted) throw err;
      throw new FetchError(`Request failed: ${(err as Error).message || "network error"}`);
    }
    if (!REDIRECTS.has(res.status)) break;
    res.cancel?.();
    const location = header(res.headers, "location");
    if (!location) throw new FetchError(`Redirect (${res.status}) without a Location header.`, res.status);
    if (hop >= MAX_REDIRECTS) throw new FetchError(`Too many redirects (more than ${MAX_REDIRECTS}).`, res.status);
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      throw new FetchError("Redirected to an invalid URL.", res.status);
    }
    url = assertFetchableUrl(next.toString());
  }

  if (res.status >= 400) {
    res.cancel?.();
    throw new FetchError(`The server responded with HTTP ${res.status}.`, res.status);
  }
  const contentType = header(res.headers, "content-type") ?? "";
  const declaredPdf = contentType.toLowerCase().startsWith("application/pdf");
  const { bytes, truncated } = await readBody(res, declaredPdf ? MAX_PDF_BYTES : MAX_TEXT_BYTES);
  const kind = classifyContent(contentType, bytes.subarray(0, 4096));

  const base = { url: start.toString(), finalUrl: url.toString(), status: res.status, contentType: contentType || "unknown" };
  if (kind === "pdf") {
    if (truncated) throw new FetchError(`The PDF is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
    const pdf = await extractPdfText(bytes).catch(() => null);
    if (!pdf) throw new FetchError("Couldn't read that PDF.");
    if (!pdf.text.trim()) throw new FetchError("That PDF has no extractable text (it may be scanned).");
    return { ...base, title: null, content: pdf.text, truncatedBody: false };
  }
  if (kind === "unsupported") {
    throw new FetchError(`Can't read content of type ${contentType.split(";")[0] || "unknown"}.`);
  }
  const text = decodeText(bytes, detectCharset(contentType, bytes, kind === "html"));
  if (kind === "html") {
    const { title, markdown } = await htmlToMarkdown(text, url.toString());
    return { ...base, title, content: markdown, truncatedBody: truncated };
  }
  return { ...base, title: null, content: text, truncatedBody: truncated };
}
