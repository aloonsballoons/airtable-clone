ALTER TABLE "base_table" ADD COLUMN "search_query" text;--> statement-breakpoint
ALTER TABLE "table_row" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "table_row_table_created_idx" ON "table_row" USING btree ("table_id","created_at");