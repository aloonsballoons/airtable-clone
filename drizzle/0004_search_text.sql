CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "table_row" ADD COLUMN "search_text" text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE "table_row"
SET "search_text" = COALESCE(
  (SELECT string_agg(value, ' ') FROM jsonb_each_text("table_row"."data")),
  ''
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "table_row_search_text_trgm_idx"
  ON "table_row" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
