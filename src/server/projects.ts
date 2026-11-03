import "server-only";
import { rm } from "node:fs/promises";
import type { Attachment, Project } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { badRequest, notFound } from "@/server/auth/errors";
import type { CurrentUser } from "@/server/auth/session";
import { readAttachmentBytes, readAttachmentText, resolveStoredPath, saveUpload } from "@/server/uploads/storage";
import { sanitizeFileName } from "@/server/uploads/document-type";
import { serializeAttachment, serializeThread, type ClientAttachment, type ClientThread } from "@/server/agent/serialize";
import { buildProjectContext, type ProjectContext } from "@/server/projects-core";
import { sandboxes } from "@/server/sandbox";

export const MAX_PROJECT_FILES = 20;
export const PROJECT_SANDBOX_DIR = "project";

export type ClientProject = {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  defaultModelId: string | null;
  defaultEffort: string | null;
  webSearchDefault: boolean | null;
  createdAt: string;
  updatedAt: string;
  threadCount: number;
  fileCount: number;
};

export type ClientProjectDetail = ClientProject & {
  files: ClientAttachment[];
  threads: ClientThread[];
};

function serializeProject(p: Project, counts: { threads: number; files: number }): ClientProject {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    instructions: p.instructions,
    defaultModelId: p.defaultModelId,
    defaultEffort: p.defaultEffort,
    webSearchDefault: p.webSearchDefault,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    threadCount: counts.threads,
    fileCount: counts.files,
  };
}

export async function getOwnedProject(user: CurrentUser, projectId: string): Promise<Project> {
  const project = await db.project.findFirst({ where: { id: projectId, userId: user.id, deletedAt: null } });
  if (!project) throw notFound("Project");
  return project;
}

export async function listProjects(user: CurrentUser): Promise<ClientProject[]> {
  const projects = await db.project.findMany({
    where: { userId: user.id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: {
        select: {
          threads: { where: { deletedAt: null, parentThreadId: null } },
          files: true,
        },
      },
    },
  });
  return projects.map((p) => serializeProject(p, { threads: p._count.threads, files: p._count.files }));
}

export async function getProjectDetail(user: CurrentUser, projectId: string): Promise<ClientProjectDetail> {
  const project = await getOwnedProject(user, projectId);
  const [files, threads] = await Promise.all([
    db.attachment.findMany({ where: { projectId: project.id, userId: user.id }, orderBy: { createdAt: "asc" } }),
    db.thread.findMany({
      where: { projectId: project.id, userId: user.id, deletedAt: null, parentThreadId: null },
      orderBy: [{ pinned: "desc" }, { lastMessageAt: "desc" }],
      take: 200,
    }),
  ]);
  return {
    ...serializeProject(project, { threads: threads.length, files: files.length }),
    files: files.map(serializeAttachment),
    threads: threads.map(serializeThread),
  };
}

export type ProjectInput = {
  name?: string;
  description?: string | null;
  instructions?: string | null;
  defaultModelId?: string | null;
  defaultEffort?: string | null;
  webSearchDefault?: boolean | null;
};

function cleanInput(input: ProjectInput) {
  const out: ProjectInput = { ...input };
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 100);
    if (!name) throw badRequest("Give the project a name.");
    out.name = name;
  }
  for (const k of ["description", "instructions"] as const) {
    if (input[k] !== undefined) out[k] = input[k]?.trim() ? input[k]!.trim() : null;
  }
  return out;
}

export async function createProject(user: CurrentUser, input: ProjectInput & { name: string }) {
  const data = cleanInput(input);
  const project = await db.project.create({ data: { ...data, name: data.name!, userId: user.id } });
  return serializeProject(project, { threads: 0, files: 0 });
}

export async function updateProject(user: CurrentUser, projectId: string, input: ProjectInput) {
  await getOwnedProject(user, projectId);
  await db.project.update({ where: { id: projectId }, data: cleanInput(input) });
  return getProjectDetail(user, projectId);
}

/** Soft delete. Threads stay but leave the project; reference files stay attached to the deleted project. */
export async function deleteProject(user: CurrentUser, projectId: string) {
  await getOwnedProject(user, projectId);
  await db.$transaction([
    db.thread.updateMany({ where: { projectId, userId: user.id }, data: { projectId: null } }),
    db.project.update({ where: { id: projectId }, data: { deletedAt: new Date() } }),
  ]);
}

export async function addProjectFile(user: CurrentUser, projectId: string, file: File) {
  await getOwnedProject(user, projectId);
  const count = await db.attachment.count({ where: { projectId } });
  if (count >= MAX_PROJECT_FILES) throw badRequest(`A project can have up to ${MAX_PROJECT_FILES} files.`);
  const att = await saveUpload(user.id, file, { projectId, documentsOnly: true });
  await db.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
  return serializeAttachment(att);
}

export async function removeProjectFile(user: CurrentUser, projectId: string, attachmentId: string) {
  await getOwnedProject(user, projectId);
  const att = await db.attachment.findFirst({ where: { id: attachmentId, projectId, userId: user.id } });
  if (!att) throw notFound("File");
  await db.attachment.delete({ where: { id: att.id } });
  for (const rel of [att.path, att.textPath]) {
    if (!rel) continue;
    await rm(resolveStoredPath(rel), { force: true }).catch(() => undefined);
  }
}

/** Move a thread into (or out of, with null) a project. */
export async function setThreadProject(user: CurrentUser, threadId: string, projectId: string | null) {
  if (projectId) await getOwnedProject(user, projectId);
  const thread = await db.thread.findFirst({ where: { id: threadId, userId: user.id, deletedAt: null } });
  if (!thread) throw notFound("Thread");
  if (thread.kind === "SUBAGENT") throw badRequest("Sub-agent threads follow their parent.");
  return db.thread.update({ where: { id: threadId }, data: { projectId } });
}

async function projectFiles(projectId: string): Promise<Attachment[]> {
  return db.attachment.findMany({ where: { projectId, kind: "DOCUMENT" }, orderBy: { createdAt: "asc" } });
}

/** Instructions + reference-file text for a run's system prompt (null when the project is gone). */
export async function loadProjectContext(projectId: string, opts: { sandboxDir?: string | null } = {}): Promise<ProjectContext | null> {
  const project = await db.project.findFirst({ where: { id: projectId, deletedAt: null } });
  if (!project) return null;
  const files = await projectFiles(project.id);
  const withText = await Promise.all(
    files.map(async (f) => ({
      fileName: f.fileName,
      text: (await readAttachmentText(f)) ?? "",
      sandboxPath: opts.sandboxDir ? `${opts.sandboxDir}/${sanitizeFileName(f.fileName)}` : null,
    })),
  );
  return buildProjectContext({ name: project.name, instructions: project.instructions, files: withText });
}

/**
 * Copy a project's reference files into a thread's sandbox (`/home/user/project`), skipping
 * names already there. Best-effort. Returns the sandbox directory, or null if nothing was copied.
 */
export async function syncProjectFilesToSandbox(projectId: string, sandboxId: string): Promise<string | null> {
  try {
    const files = await projectFiles(projectId);
    if (files.length === 0) return null;
    const existing = new Set((await sandboxes().list(sandboxId)).map((e) => e.path));
    const base = `/home/user/${PROJECT_SANDBOX_DIR}`;
    const missing = files.filter((f) => !existing.has(`${base}/${sanitizeFileName(f.fileName)}`));
    if (missing.length) {
      const payload = await Promise.all(
        missing.map(async (f) => ({ name: sanitizeFileName(f.fileName), bytes: new Uint8Array(await readAttachmentBytes(f.path)) })),
      );
      await sandboxes().addFiles(sandboxId, PROJECT_SANDBOX_DIR, payload, "skip-existing");
    }
    return base;
  } catch (err) {
    console.warn("[projects] could not copy project files into the sandbox:", err);
    return null;
  }
}
