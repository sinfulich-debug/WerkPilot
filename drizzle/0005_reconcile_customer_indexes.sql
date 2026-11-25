CREATE UNIQUE INDEX IF NOT EXISTS "customers_tenant_id_id_unique"
  ON "customers" USING btree ("tenant_id", "id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_tenant_id_idx"
  ON "customers" USING btree ("tenant_id");