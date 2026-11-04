-- CreateEnum
CREATE TYPE "PromptScope" AS ENUM ('USER', 'INSTANCE');

-- CreateTable
CREATE TABLE "prompt" (
    "id" TEXT NOT NULL,
    "scope" "PromptScope" NOT NULL DEFAULT 'USER',
    "userId" TEXT,
    "command" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prompt_userId_idx" ON "prompt"("userId");

-- CreateIndex
CREATE INDEX "prompt_scope_idx" ON "prompt"("scope");

-- AddForeignKey
ALTER TABLE "prompt" ADD CONSTRAINT "prompt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Commands are unique per user for personal prompts, and instance-wide for shared prompts.
CREATE UNIQUE INDEX "prompt_user_command_key" ON "prompt"("userId", "command") WHERE "scope" = 'USER';
CREATE UNIQUE INDEX "prompt_instance_command_key" ON "prompt"("command") WHERE "scope" = 'INSTANCE';
