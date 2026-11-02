import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/config/env";
import { db } from "@/server/db";
import { badRequest } from "@/server/auth/errors";
import { extensionFor, MAX_IMAGE_BYTES, sniffImageType } from "@/server/uploads/image-type";

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

export async function saveImage(userId: string, file: File) {
  if (file.size > MAX_IMAGE_BYTES) throw badRequest("Images must be 10 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImageType(bytes);
  if (!mime) throw badRequest("Only PNG, JPEG, WebP, and GIF images are supported.");
  if (!/^[\w-]+$/.test(userId)) throw new Error("Invalid user id");

  const relative = path.join(/*turbopackIgnore: true*/ userId, `${randomUUID()}.${extensionFor(mime)}`);
  const full = resolveStoredPath(relative);
  await mkdir(path.dirname(/*turbopackIgnore: true*/ full), { recursive: true });
  await writeFile(full, bytes);

  return db.attachment.create({
    data: {
      userId,
      path: relative,
      fileName: (file.name || "image").slice(0, 200),
      mime,
      size: bytes.byteLength,
    },
  });
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
