CREATE TABLE "tire_storages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"slot" varchar(40) NOT NULL,
	"season" varchar(10) NOT NULL,
	"description" varchar(200) NOT NULL,
	"tread_depth_tenth_mm" integer,
	"stored_at" date NOT NULL,
	"released_at" date,
	"last_reminder_sent_at" date,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tire_storages_season_valid" CHECK ("tire_storages"."season" IN ('summer','winter','allseason')),
	CONSTRAINT "tire_storages_slot_not_blank" CHECK (char_length(btrim("tire_storages"."slot")) > 0),
	CONSTRAINT "tire_storages_description_not_blank" CHECK (char_length(btrim("tire_storages"."description")) > 0),
	CONSTRAINT "tire_storages_tread_depth_range" CHECK ("tire_storages"."tread_depth_tenth_mm" IS NULL OR ("tire_storages"."tread_depth_tenth_mm" >= 0 AND "tire_storages"."tread_depth_tenth_mm" <= 150)),
	CONSTRAINT "tire_storages_notes_length" CHECK ("tire_storages"."notes" IS NULL OR char_length("tire_storages"."notes") <= 1000),
	CONSTRAINT "tire_storages_release_after_store" CHECK ("tire_storages"."released_at" IS NULL OR "tire_storages"."released_at" >= "tire_storages"."stored_at")
);
--> statement-breakpoint
ALTER TABLE "tire_storages" ADD CONSTRAINT "tire_storages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tire_storages" ADD CONSTRAINT "tire_storages_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tire_storages" ADD CONSTRAINT "tire_storages_tenant_vehicle_fk" FOREIGN KEY ("tenant_id","vehicle_id") REFERENCES "public"."vehicles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tire_storages_active_slot_unique" ON "tire_storages" USING btree ("tenant_id","slot") WHERE "tire_storages"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "tire_storages_tenant_customer_idx" ON "tire_storages" USING btree ("tenant_id","customer_id");--> statement-breakpoint
-- Row-level security: every member may look up where a set is stored (the mechanic fetches the wheels);
-- only owner and office store, change and release sets. Nothing is ever deleted (released_at archives).
ALTER TABLE public.tire_storages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.tire_storages FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tire_storages_member_select ON public.tire_storages FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')));--> statement-breakpoint
CREATE POLICY tire_storages_owner_office_insert ON public.tire_storages FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office')));--> statement-breakpoint
CREATE POLICY tire_storages_owner_office_update ON public.tire_storages FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office')))
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office')));--> statement-breakpoint
REVOKE ALL ON TABLE public.tire_storages FROM anon;--> statement-breakpoint
REVOKE ALL ON TABLE public.tire_storages FROM authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.tire_storages TO authenticated;
