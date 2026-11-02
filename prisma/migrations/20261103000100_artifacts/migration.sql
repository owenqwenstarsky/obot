-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('MARKDOWN', 'HTML', 'REACT');

-- CreateEnum
CREATE TYPE "ArtifactStatus" AS ENUM ('GENERATING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "artifact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "ArtifactKind" NOT NULL,
    "status" "ArtifactStatus" NOT NULL DEFAULT 'READY',
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "runId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_version" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "artifact_userId_deletedAt_updatedAt_idx" ON "artifact"("userId", "deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "artifact_threadId_idx" ON "artifact"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_version_artifactId_version_key" ON "artifact_version"("artifactId", "version");

-- AddForeignKey
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_version" ADD CONSTRAINT "artifact_version_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

