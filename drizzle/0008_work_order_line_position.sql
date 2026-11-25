ALTER TABLE "work_order_lines" ADD COLUMN "position" integer;--> statement-breakpoint
WITH ordered_lines AS (
  SELECT
    "id",
    row_number() OVER (PARTITION BY "work_order_id" ORDER BY "created_at", "id") AS "position"
  FROM "work_order_lines"
)
UPDATE "work_order_lines"
SET "position" = ordered_lines."position"
FROM ordered_lines
WHERE "work_order_lines"."id" = ordered_lines."id";--> statement-breakpoint
ALTER TABLE "work_order_lines" ALTER COLUMN "position" SET NOT NULL;