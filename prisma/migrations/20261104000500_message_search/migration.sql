-- AlterTable
ALTER TABLE "message" ADD COLUMN     "searchText" TEXT;


-- Backfill: text of user messages, replies, and mid-run steering messages.
UPDATE "message" AS m
SET "searchText" = t."text"
FROM (
  SELECT msg."id", string_agg(p->>'text', E'\n\n' ORDER BY p_ord) AS "text"
  FROM "message" AS msg
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(msg."parts") = 'array' THEN msg."parts" ELSE '[]'::jsonb END)
    WITH ORDINALITY AS e(p, p_ord)
  WHERE p->>'type' IN ('text', 'user_text', 'steer') AND coalesce(p->>'text', '') <> ''
  GROUP BY msg."id"
) AS t
WHERE m."id" = t."id";

-- Full-text index ('simple' config: no stemming, works for any language).
CREATE INDEX "message_search_idx" ON "message" USING GIN (to_tsvector('simple', coalesce("searchText", '')));
