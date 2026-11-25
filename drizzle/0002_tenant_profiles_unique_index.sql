CREATE UNIQUE INDEX IF NOT EXISTS "tenant_profiles_tenant_id_unique"
	ON "tenant_profiles" USING btree ("tenant_id");