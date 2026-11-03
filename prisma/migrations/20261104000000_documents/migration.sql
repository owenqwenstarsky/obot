-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('IMAGE', 'DOCUMENT');

-- AlterTable
ALTER TABLE "attachment" ADD COLUMN     "kind" "AttachmentKind" NOT NULL DEFAULT 'IMAGE',
ADD COLUMN     "pageCount" INTEGER,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "textChars" INTEGER,
ADD COLUMN     "textPath" TEXT;

