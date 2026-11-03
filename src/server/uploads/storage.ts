import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/config/env";
import { db } from "@/server/db";
import { badRequest, notFound } from "@/server/auth/errors";
import { extensionFor, MAX_IMAGE_BYTES } from "@/server/uploads/image-type";
import { classifyUpload, contentDisposition, MAX_DOCUMENT_BYTES, MAX_UPLOAD_BYTES } from "@/server/uploads/document-type";
import { extractDocumentText } from "@/server/uploads/extract";

function uploadRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ env().UPLOAD_DIR);
}

/** Resolve a stored relative path, refusing anything that escapes the upload root. */
export function resolveStoredPath(relative: string): string {
  const root = uploadRoot();
  const full = path.resolve(/*turbopackIgnore: true*/ root, relative);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid attachment path");
  return full;
}

export type SaveUploadOptions = {
  /** Attach as a project reference file (documents only). */
  projectId?: string | null;
  /** Reject images (e.g. project files). */
  documentsOnly?: boolean;
};

/** Validate, store, and record an upload. Documents also get a `.txt` sidecar with extracted text. */
export async function saveUpload(userId: string, file: File, opts: SaveUploadOptions = {}) {
  if (!/^[\w-]+$/.test(userId)) throw new Error("Invalid user id");
  if (file.size > MAX_UPLOAD_BYTES) throw badRequest("Files must be 10 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = (file.name || "file").slice(0, 200);
  const cls = classifyUpload(name, bytes);
  if (!cls) {
    throw badRequest(
      "Unsupported file. Upload an image (PNG, JPEG, WebP, GIF), a PDF, or a UTF-8 text file (txt, md, csv, json, code…).",
    );
  }
  if (cls.kind === "image" && opts.documentsOnly) throw badRequest("Only documents (PDF or text files) can be added here.");
  if (cls.kind === "image" && bytes.byteLength > MAX_IMAGE_BYTES) throw badRequest("Images must be 10 MB or smaller.");
  if (cls.kind !== "image" && bytes.byteLength > MAX_DOCUMENT_BYTES) throw badRequest("Documents must be 10 MB or smaller.");

  const ext = cls.kind === "image" ? extensionFor(cls.mime) : cls.kind === "pdf" ? "pdf" : "bin";
  const id = randomUUID();
  const relative = path.join(/*turbopackIgnore: true*/ userId, `${id}.${ext}`);
  const full = resolveStoredPath(relative);
  await mkdir(path.dirname(/*turbopackIgnore: true*/ full), { recursive: true });
  await writeFile(full, bytes);

  let textPath: string | null = null;
  let textChars: number | null = null;
  let pageCount: number | null = null;
  if (cls.kind !== "image") {
    const extracted = await extractDocumentText(cls.kind, bytes);
    textPath = path.join(/*turbopackIgnore: true*/ userId, `${id}.txt`);
    await writeFile(resolveStoredPath(textPath), extracted.text, "utf8");
    textChars = extracted.text.length;
    pageCount = extracted.pageCount;
  }

  return db.attachment.create({
    data: {
      userId,
      path: relative,
      fileName: name,
      mime: cls.mime,
      size: bytes.byteLength,
      kind: cls.kind === "image" ? "IMAGE" : "DOCUMENT",
      textPath,
      textChars,
      pageCount,
      projectId: opts.projectId ?? null,
    },
  });
}

/** Extracted text of a document attachment; null when missing. */
export async function readAttachmentText(att: { textPath: string | null }): Promise<string | null> {
  if (!att.textPath) return null;
  try {
    return await readFile(resolveStoredPath(att.textPath), "utf8");
  } catch {
    return null;
  }
}

export async function readAttachmentBytes(relative: string): Promise<Buffer> {
  return readFile(resolveStoredPath(relative));
}

export async function attachmentDataUrl(relative: string, mime: string): Promise<string | null> {
  try {
    const buf = await readAttachmentBytes(relative);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Serve stored attachment bytes. Images render inline; documents are always downloaded
 * as octet-stream so the browser never interprets them (e.g. HTML uploads).
 */
export async function attachmentResponse(
  att: { path: string; mime: string; kind: "IMAGE" | "DOCUMENT"; fileName: string },
  cacheControl: string,
): Promise<Response> {
  const bytes = await readAttachmentBytes(att.path).catch(() => null);
  if (!bytes) throw notFound("Attachment");
  const isImage = att.kind === "IMAGE";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": isImage ? att.mime : "application/octet-stream",
      "content-length": String(bytes.byteLength),
      ...(isImage ? {} : { "content-disposition": contentDisposition("attachment", att.fileName) }),
      "cache-control": cacheControl,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
