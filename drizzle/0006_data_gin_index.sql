CREATE INDEX IF NOT EXISTS "table_row_data_gin_idx"
  ON "table_row" USING gin ("data");
