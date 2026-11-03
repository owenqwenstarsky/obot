-- AlterTable
ALTER TABLE "thread" ADD COLUMN     "currentLeafId" TEXT;

-- AlterTable
ALTER TABLE "message" ADD COLUMN     "compareGroupId" TEXT,
ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "message_parentId_idx" ON "message"("parentId");

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "message"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: existing threads are linear, so each message's parent is the previous message.
UPDATE "message" AS m
SET "parentId" = o."prevId"
FROM (
  SELECT "id", LAG("id") OVER (PARTITION BY "threadId" ORDER BY "createdAt", "id") AS "prevId"
  FROM "message"
) AS o
WHERE m."id" = o."id" AND o."prevId" IS NOT NULL;

-- Backfill: the current branch of each thread ends at its newest message.
UPDATE "thread" AS t
SET "currentLeafId" = l."id"
FROM (
  SELECT DISTINCT ON ("threadId") "threadId", "id"
  FROM "message"
  ORDER BY "threadId", "createdAt" DESC, "id" DESC
) AS l
WHERE t."id" = l."threadId";
