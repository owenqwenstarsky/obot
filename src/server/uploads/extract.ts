/** Text extraction for uploaded documents and fetched PDFs. */
import { decodeUtf8Text } from "@/server/uploads/document-type";

export type ExtractedText = { text: string; pageCount: number | null };

/** Join per-page text with page markers so the model can cite pages. Pure. */
export function joinPdfPages(pages: string[]): string {
  if (pages.length <= 1) return (pages[0] ?? "").trim();
  return pages
    .map((t, i) => `--- Page ${i + 1} ---\n${t.trim()}`)
    .join("\n\n")
    .trim();
}

export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedText> {
  const { extractText } = await import("unpdf");
  // pdf.js may transfer (detach) the buffer it is given, so hand it a copy.
  const { totalPages, text } = await extractText(new Uint8Array(bytes), { mergePages: false });
  const joined = joinPdfPages(text);
  // A scanned PDF yields only page markers; treat that as "no text".
  const hasText = text.some((t) => t.trim().length > 0);
  return { text: hasText ? joined : "", pageCount: totalPages };
}

/** Extract text from a classified document. Never throws: failures yield empty text. */
export async function extractDocumentText(kind: "pdf" | "text", bytes: Uint8Array): Promise<ExtractedText> {
  try {
    if (kind === "pdf") return await extractPdfText(bytes);
    return { text: decodeUtf8Text(bytes) ?? "", pageCount: null };
  } catch {
    return { text: "", pageCount: null };
  }
}
