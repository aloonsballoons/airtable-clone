ALTER TABLE "base_table" ADD COLUMN IF NOT EXISTS "sort_config" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
UPDATE "base_table"
SET "sort_config" = jsonb_build_array(
  jsonb_build_object(
    'columnId', "sort_column_id",
    'direction', CASE WHEN "sort_direction" = 'desc' THEN 'desc' ELSE 'asc' END
  )
)
WHERE "sort_column_id" IS NOT NULL
  AND ("sort_config" IS NULL OR "sort_config" = '[]'::jsonb);
