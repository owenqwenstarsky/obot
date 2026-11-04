-- CreateEnum
CREATE TYPE "MemorySource" AS ENUM ('AGENT', 'USER');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "aboutMe" TEXT,
ADD COLUMN     "memoryEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "responseStyle" TEXT;

-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN     "memoryEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "memory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" "MemorySource" NOT NULL DEFAULT 'AGENT',
    "threadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memory_userId_updatedAt_idx" ON "memory"("userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "memory" ADD CONSTRAINT "memory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

