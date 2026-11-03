import "server-only";
import type { Memory } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { badRequest, notFound } from "@/server/auth/errors";

export const MAX_MEMORIES = 200;
export const MAX_MEMORY_CHARS = 1000;

export type ClientMemory = {
  id: string;
  content: string;
  source: "AGENT" | "USER";
  threadId: string | null;
  createdAt: string;
  updatedAt: string;
};

export function serializeMemory(m: Memory): ClientMemory {
  return {
    id: m.id,
    content: m.content,
    source: m.source,
    threadId: m.threadId,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

function clean(content: string): string {
  const c = content.replace(/\s+/g, " ").trim();
  if (!c) throw badRequest("A memory can't be empty.");
  if (c.length > MAX_MEMORY_CHARS) throw badRequest(`Keep memories under ${MAX_MEMORY_CHARS} characters.`);
  return c;
}

export async function listMemories(userId: string, limit = MAX_MEMORIES): Promise<Memory[]> {
  return db.memory.findMany({ where: { userId }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: limit });
}

export async function addMemory(userId: string, content: string, opts: { source: "AGENT" | "USER"; threadId?: string | null }) {
  const text = clean(content);
  const count = await db.memory.count({ where: { userId } });
  if (count >= MAX_MEMORIES) {
    throw badRequest(`Memory is full (${MAX_MEMORIES} items). Delete some on the Memories page first.`);
  }
  const dupe = await db.memory.findFirst({ where: { userId, content: { equals: text, mode: "insensitive" } } });
  if (dupe) return db.memory.update({ where: { id: dupe.id }, data: { updatedAt: new Date() } });
  return db.memory.create({ data: { userId, content: text, source: opts.source, threadId: opts.threadId ?? null } });
}

export async function updateMemory(userId: string, id: string, content: string) {
  const existing = await db.memory.findFirst({ where: { id, userId } });
  if (!existing) throw notFound("Memory");
  return db.memory.update({ where: { id }, data: { content: clean(content), source: "USER" } });
}

/** Returns the deleted memory, or null when it doesn't exist (or isn't the user's). */
export async function deleteMemory(userId: string, id: string): Promise<Memory | null> {
  const existing = await db.memory.findFirst({ where: { id, userId } });
  if (!existing) return null;
  await db.memory.delete({ where: { id } });
  return existing;
}

export async function clearMemories(userId: string) {
  const { count } = await db.memory.deleteMany({ where: { userId } });
  return count;
}
