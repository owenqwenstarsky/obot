import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { addMemory, clearMemories, listMemories, MAX_MEMORY_CHARS, serializeMemory } from "@/server/memories";
import { handler, json, parseBody } from "@/server/http";

export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  return json({ memories: (await listMemories(user.id)).map(serializeMemory) });
});

const createSchema = z.object({ content: z.string().min(1).max(MAX_MEMORY_CHARS) });

export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const { content } = await parseBody(req, createSchema);
  return json({ memory: serializeMemory(await addMemory(user.id, content, { source: "USER" })) });
});

/** Clear all memories. */
export const DELETE = handler(async (req: Request) => {
  const user = await requireUser(req);
  return json({ deleted: await clearMemories(user.id) });
});
