-- CreateEnum
CREATE TYPE "ThreadKind" AS ENUM ('CHAT', 'SUBAGENT');

-- CreateEnum
CREATE TYPE "SubagentTaskStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED');

-- AlterEnum
ALTER TYPE "UsageKind" ADD VALUE 'SUBAGENT';

-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN     "agentMaxSteps" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "artifactsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "inlineUiEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sandboxEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sandboxPythonEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "subagentMaxConcurrent" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "subagentMaxSteps" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "subagentsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "thread" ADD COLUMN     "kind" "ThreadKind" NOT NULL DEFAULT 'CHAT',
ADD COLUMN     "parentThreadId" TEXT;

-- AlterTable
ALTER TABLE "run" ADD COLUMN     "kind" "ThreadKind" NOT NULL DEFAULT 'CHAT',
ADD COLUMN     "parentRunId" TEXT,
ADD COLUMN     "steps" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "usage_record" ADD COLUMN     "rootThreadId" TEXT,
ADD COLUMN     "stepIndex" INTEGER;

-- CreateTable
CREATE TABLE "subagent_model" (
    "modelId" TEXT NOT NULL,
    "description" TEXT,
    "defaultEffort" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subagent_model_pkey" PRIMARY KEY ("modelId")
);

-- CreateTable
CREATE TABLE "subagent_task" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentThreadId" TEXT NOT NULL,
    "parentRunId" TEXT NOT NULL,
    "parentMessageId" TEXT,
    "callId" TEXT NOT NULL,
    "childThreadId" TEXT NOT NULL,
    "childRunId" TEXT,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "effort" TEXT,
    "status" "SubagentTaskStatus" NOT NULL DEFAULT 'RUNNING',
    "result" TEXT,
    "error" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "subagent_task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subagent_task_childThreadId_key" ON "subagent_task"("childThreadId");

-- CreateIndex
CREATE INDEX "subagent_task_parentRunId_status_idx" ON "subagent_task"("parentRunId", "status");

-- CreateIndex
CREATE INDEX "subagent_task_parentThreadId_idx" ON "subagent_task"("parentThreadId");

-- CreateIndex
CREATE INDEX "subagent_task_status_idx" ON "subagent_task"("status");

-- CreateIndex
CREATE INDEX "thread_parentThreadId_idx" ON "thread"("parentThreadId");

-- CreateIndex
CREATE INDEX "run_parentRunId_idx" ON "run"("parentRunId");

-- CreateIndex
CREATE INDEX "usage_record_rootThreadId_idx" ON "usage_record"("rootThreadId");

-- AddForeignKey
ALTER TABLE "thread" ADD CONSTRAINT "thread_parentThreadId_fkey" FOREIGN KEY ("parentThreadId") REFERENCES "thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subagent_model" ADD CONSTRAINT "subagent_model_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subagent_task" ADD CONSTRAINT "subagent_task_parentThreadId_fkey" FOREIGN KEY ("parentThreadId") REFERENCES "thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subagent_task" ADD CONSTRAINT "subagent_task_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subagent_task" ADD CONSTRAINT "subagent_task_childThreadId_fkey" FOREIGN KEY ("childThreadId") REFERENCES "thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

