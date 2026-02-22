ALTER TABLE "base_table" ADD COLUMN "row_count" integer NOT NULL DEFAULT 0;--> statement-breakpoint
-- Backfill existing tables with actual row counts
UPDATE "base_table" SET "row_count" = (
  SELECT count(*)::int FROM "table_row" WHERE "table_row"."table_id" = "base_table"."id"
);
