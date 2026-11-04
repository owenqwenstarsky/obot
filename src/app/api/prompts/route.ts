import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { createPrompt, listPrompts } from "@/server/prompts";
import { handler, json, parseBody } from "@/server/http";

export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  return json({ prompts: await listPrompts(user) });
});

const createSchema = z.object({
  command: z.string().min(1).max(60),
  title: z.string().max(100).nullish(),
  body: z.string().min(1).max(20_000),
  /** Share with everyone on the instance (admins only). */
  shared: z.boolean().optional(),
});

export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = await parseBody(req, createSchema);
  return json({ prompt: await createPrompt(user, body) });
});
