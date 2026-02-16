CREATE TABLE "table_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_config" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hidden_column_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"search_query" text,
	"filter_config" jsonb DEFAULT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "table_view" ADD CONSTRAINT "table_view_table_id_base_table_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."base_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "table_view_table_idx" ON "table_view" USING btree ("table_id");