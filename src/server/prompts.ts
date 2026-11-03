import "server-only";
import type { Prompt } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { badRequest, forbidden, HttpError, notFound } from "@/server/auth/errors";
import type { CurrentUser } from "@/server/auth/session";
import { normalizeCommand } from "@/lib/slash";

export const MAX_PROMPTS_PER_USER = 200;

export type ClientPrompt = {
  id: string;
  scope: "USER" | "INSTANCE";
  command: string;
  title: string;
  body: string;
  /** The current user can edit or delete it. */
  editable: boolean;
  updatedAt: string;
};

function serialize(p: Prompt, user: CurrentUser): ClientPrompt {
  return {
    id: p.id,
    scope: p.scope,
    command: p.command,
    title: p.title,
    body: p.body,
    editable: p.scope === "USER" ? p.userId === user.id : user.role === "ADMIN",
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function listPrompts(user: CurrentUser): Promise<ClientPrompt[]> {
  const rows = await db.prompt.findMany({
    where: { OR: [{ scope: "USER", userId: user.id }, { scope: "INSTANCE" }] },
    orderBy: [{ command: "asc" }],
  });
  return rows.map((p) => serialize(p, user));
}

export type PromptInput = { command: string; title?: string | null; body: string; shared?: boolean };

function clean(input: Partial<PromptInput>) {
  const out: { command?: string; title?: string; body?: string } = {};
  if (input.command !== undefined) {
    const command = normalizeCommand(input.command);
    if (!command) throw badRequest("Commands need at least one letter or digit.");
    out.command = command;
  }
  if (input.body !== undefined) {
    if (!input.body.trim()) throw badRequest("The prompt can't be empty.");
    out.body = input.body;
  }
  if (input.title !== undefined) out.title = input.title?.trim().slice(0, 100) || out.command || "";
  return out;
}

async function assertCommandFree(scope: "USER" | "INSTANCE", userId: string, command: string, exceptId?: string) {
  const clash = await db.prompt.findFirst({
    where: { command, ...(scope === "USER" ? { scope, userId } : { scope }), ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new HttpError(409, `/${command} already exists${scope === "INSTANCE" ? " as a shared prompt" : ""}.`, "COMMAND_TAKEN");
}

function rethrowUnique(err: unknown, command: string): never {
  if ((err as { code?: string }).code === "P2002") throw new HttpError(409, `/${command} already exists.`, "COMMAND_TAKEN");
  throw err;
}

export async function createPrompt(user: CurrentUser, input: PromptInput) {
  const scope = input.shared ? "INSTANCE" : "USER";
  if (scope === "INSTANCE" && user.role !== "ADMIN") throw forbidden();
  const data = clean({ ...input, title: input.title ?? null });
  if (scope === "USER" && (await db.prompt.count({ where: { scope: "USER", userId: user.id } })) >= MAX_PROMPTS_PER_USER) {
    throw badRequest(`You can save up to ${MAX_PROMPTS_PER_USER} prompts.`);
  }
  await assertCommandFree(scope, user.id, data.command!);
  const p = await db.prompt
    .create({ data: { scope, userId: user.id, command: data.command!, title: data.title || data.command!, body: data.body! } })
    .catch((err) => rethrowUnique(err, data.command!));
  return serialize(p, user);
}

async function getEditable(user: CurrentUser, id: string) {
  const p = await db.prompt.findUnique({ where: { id } });
  if (!p || (p.scope === "USER" && p.userId !== user.id)) throw notFound("Prompt");
  if (p.scope === "INSTANCE" && user.role !== "ADMIN") throw forbidden();
  return p;
}

export async function updatePrompt(user: CurrentUser, id: string, input: Partial<Omit<PromptInput, "shared">>) {
  const existing = await getEditable(user, id);
  const data = clean(input);
  if (data.command && data.command !== existing.command) {
    await assertCommandFree(existing.scope, existing.userId ?? user.id, data.command, id);
  }
  const p = await db.prompt.update({ where: { id }, data }).catch((err) => rethrowUnique(err, data.command ?? existing.command));
  return serialize(p, user);
}

export async function deletePrompt(user: CurrentUser, id: string) {
  await getEditable(user, id);
  await db.prompt.delete({ where: { id } });
}
