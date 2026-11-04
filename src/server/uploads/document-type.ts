/**
 * Classifies uploaded files (pure). Images are detected from magic bytes; documents are
 * PDFs (magic bytes) or UTF-8 text files with an allowlisted extension.
 */
import { MAX_IMAGE_BYTES, sniffImageType, type ImageMime } from "@/server/uploads/image-type";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = Math.max(MAX_IMAGE_BYTES, MAX_DOCUMENT_BYTES);
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/** Extension → MIME type stored for text documents. */
const TEXT_EXTENSIONS: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  jsonl: "application/jsonl",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  toml: "application/toml",
  ini: "text/plain",
  log: "text/plain",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  scss: "text/x-scss",
  sql: "application/sql",
  sh: "application/x-sh",
  js: "text/javascript",
  jsx: "text/javascript",
  ts: "text/typescript",
  tsx: "text/typescript",
  py: "text/x-python",
  rb: "text/x-ruby",
  go: "text/x-go",
  rs: "text/x-rust",
  java: "text/x-java",
  kt: "text/x-kotlin",
  c: "text/x-c",
  h: "text/x-c",
  cpp: "text/x-c++",
  hpp: "text/x-c++",
  cs: "text/x-csharp",
  php: "text/x-php",
  swift: "text/x-swift",
};

export const DOCUMENT_EXTENSIONS = ["pdf", ...Object.keys(TEXT_EXTENSIONS)];

export type UploadClass =
  | { kind: "image"; mime: ImageMime }
  | { kind: "pdf"; mime: "application/pdf" }
  | { kind: "text"; mime: string };

export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d // -
  );
}

/** Strict UTF-8 decode; null for binary content (NUL bytes or invalid sequences). */
export function decodeUtf8Text(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return null;
  }
}

export function classifyUpload(name: string, bytes: Uint8Array): UploadClass | null {
  const image = sniffImageType(bytes);
  if (image) return { kind: "image", mime: image };
  if (isPdf(bytes)) return { kind: "pdf", mime: "application/pdf" };
  const mime = TEXT_EXTENSIONS[fileExtension(name)];
  if (mime && decodeUtf8Text(bytes) !== null) return { kind: "text", mime };
  return null;
}

/** A filename safe for the sandbox and Content-Disposition (keeps the extension). */
export function sanitizeFileName(name: string, fallback = "file"): string {
  const base = (name.split(/[\\/]/).pop() ?? "").normalize("NFC");
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const out = cleaned.slice(-120);
  return out || fallback;
}

/** RFC 5987 Content-Disposition value (pure). */
export function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
