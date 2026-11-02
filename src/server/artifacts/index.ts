import "server-only";
import { db } from "@/server/db";
import type { ArtifactRow, ArtifactStore } from "@/server/artifacts/core";
import { fromDbKind } from "@/server/artifacts/core";
import type { Artifact, ArtifactVersion } from "@/generated/prisma/client";

export const prismaArtifactStore: ArtifactStore = {
  async get(id) {
    return db.artifact.findUnique({ where: { id } }) as Promise<ArtifactRow | null>;
  },
  async createWithVersion(a) {
    return db.$transaction(async (tx) => {
      const art = await tx.artifact.create({
        data: { userId: a.userId, threadId: a.threadId, runId: a.runId, title: a.title, kind: a.kind, status: "READY", currentVersion: 1 },
      });
      await tx.artifactVersion.create({
        data: { artifactId: art.id, version: 1, title: a.title, content: a.content, messageId: a.messageId },
      });
      return art;
    });
  },
  async addVersion(a) {
    return db.$transaction(async (tx) => {
      const version = a.expectedVersion + 1;
      await tx.artifactVersion.create({
        data: { artifactId: a.artifactId, version, title: a.title, content: a.content, messageId: a.messageId },
      });
      return tx.artifact.update({
        where: { id: a.artifactId },
        data: { currentVersion: version, title: a.title, status: "READY", error: null, ...(a.kind ? { kind: a.kind } : {}) },
      });
    });
  },
  async markFailed(id, error) {
    await db.artifact.updateMany({ where: { id, status: "GENERATING" }, data: { status: "FAILED", error } });
  },
};

export type ClientArtifact = {
  id: string;
  title: string;
  kind: "markdown" | "html" | "react";
  status: "GENERATING" | "READY" | "FAILED";
  currentVersion: number;
  threadId: string;
  threadTitle: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClientArtifactDetail = ClientArtifact & {
  versions: { version: number; title: string; createdAt: string }[];
  version: { version: number; title: string; content: string; createdAt: string } | null;
};

type WithThread = Artifact & { thread: { title: string; deletedAt: Date | null } | null };

export function serializeArtifact(a: WithThread): ClientArtifact {
  return {
    id: a.id,
    title: a.title,
    kind: fromDbKind(a.kind),
    status: a.status,
    currentVersion: a.currentVersion,
    threadId: a.threadId,
    threadTitle: a.thread && !a.thread.deletedAt ? a.thread.title : null,
    error: a.error,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

const visible = (userId: string) => ({ userId, deletedAt: null, thread: { deletedAt: null } });

export async function listArtifacts(userId: string, ids?: string[]) {
  const rows = await db.artifact.findMany({
    where: { ...visible(userId), ...(ids ? { id: { in: ids.slice(0, 200) } } : {}) },
    include: { thread: { select: { title: true, deletedAt: true } } },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  return rows.map(serializeArtifact);
}

export async function getArtifactDetail(userId: string, id: string, version?: number | null): Promise<ClientArtifactDetail | null> {
  const a = await db.artifact.findFirst({
    where: { id, ...visible(userId) },
    include: {
      thread: { select: { title: true, deletedAt: true } },
      versions: { select: { version: true, title: true, createdAt: true }, orderBy: { version: "asc" } },
    },
  });
  if (!a) return null;
  const wanted = version && version > 0 ? version : a.currentVersion;
  const v: ArtifactVersion | null = wanted
    ? await db.artifactVersion.findUnique({ where: { artifactId_version: { artifactId: id, version: wanted } } })
    : null;
  return {
    ...serializeArtifact(a),
    versions: a.versions.map((x) => ({ version: x.version, title: x.title, createdAt: x.createdAt.toISOString() })),
    version: v ? { version: v.version, title: v.title, content: v.content, createdAt: v.createdAt.toISOString() } : null,
  };
}
