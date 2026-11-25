CREATE TABLE "vehicle_inspection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inspection_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" varchar(120) NOT NULL,
	"status" varchar(10) DEFAULT 'gruen' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_inspection_items_status_valid" CHECK ("vehicle_inspection_items"."status" IN ('gruen', 'gelb', 'rot')),
	CONSTRAINT "vehicle_inspection_items_note_length" CHECK (char_length("vehicle_inspection_items"."note") <= 2000),
	CONSTRAINT "vehicle_inspection_items_label_not_blank" CHECK (char_length(btrim("vehicle_inspection_items"."label")) > 0)
);
--> statement-breakpoint
CREATE TABLE "vehicle_inspection_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"data_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_inspection_photos_size" CHECK (char_length("vehicle_inspection_photos"."data_url") <= 800000),
	CONSTRAINT "vehicle_inspection_photos_jpeg" CHECK (starts_with("vehicle_inspection_photos"."data_url", 'data:image/jpeg' || chr(59) || 'base64,'))
);
--> statement-breakpoint
CREATE TABLE "vehicle_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_name" varchar(200) DEFAULT '' NOT NULL,
	"vehicle_label" varchar(200) DEFAULT '' NOT NULL,
	"plate" varchar(20) DEFAULT '' NOT NULL,
	"customer_id" uuid,
	"vehicle_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The unique (tenant_id, id) indexes must exist BEFORE the foreign keys that point at them (drizzle-kit puts them after).
CREATE UNIQUE INDEX "vehicle_inspections_tenant_id_id_unique" ON "vehicle_inspections" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_inspection_items_tenant_id_id_unique" ON "vehicle_inspection_items" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "vehicle_inspection_items" ADD CONSTRAINT "vehicle_inspection_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspection_items" ADD CONSTRAINT "vehicle_inspection_items_tenant_inspection_fk" FOREIGN KEY ("tenant_id","inspection_id") REFERENCES "public"."vehicle_inspections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspection_photos" ADD CONSTRAINT "vehicle_inspection_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspection_photos" ADD CONSTRAINT "vehicle_inspection_photos_tenant_item_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."vehicle_inspection_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_tenant_vehicle_fk" FOREIGN KEY ("tenant_id","vehicle_id") REFERENCES "public"."vehicles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_inspection_items_inspection_idx" ON "vehicle_inspection_items" USING btree ("inspection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_inspection_photos_item_unique" ON "vehicle_inspection_photos" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "vehicle_inspection_photos_tenant_idx" ON "vehicle_inspection_photos" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "vehicle_inspections_tenant_created_idx" ON "vehicle_inspections" USING btree ("tenant_id","created_at");--> statement-breakpoint
-- Row-level security: every member of the workshop (owner, office, mechanic) may read and fill in
-- inspections - doing them is the mechanic's job. Deleting a whole inspection is for owner and office.
-- Items and photos follow their inspection (cascade); members may remove a photo or an item.
ALTER TABLE public.vehicle_inspections ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vehicle_inspections FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vehicle_inspection_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vehicle_inspection_items FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vehicle_inspection_photos ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vehicle_inspection_photos FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY vehicle_inspections_member_select ON public.vehicle_inspections FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')));--> statement-breakpoint
CREATE POLICY vehicle_inspections_member_insert ON public.vehicle_inspections FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')));--> statement-breakpoint
CREATE POLICY vehicle_inspections_member_update ON public.vehicle_inspections FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')))
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')));--> statement-breakpoint
CREATE POLICY vehicle_inspections_owner_office_delete ON public.vehicle_inspections FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office')));--> statement-breakpoint

CREATE POLICY vehicle_inspection_items_member_select ON public.vehicle_inspection_items FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')));--> statement-breakpoint
CREATE POLICY vehicle_inspection_items_member_insert ON public.vehicle_inspection_items FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')));--> statement-breakpoint
CREATE POLICY vehicle_inspection_items_member_update ON public.vehicle_inspection_items FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')))
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')));--> statement-breakpoint
CREATE POLICY vehicle_inspection_items_member_delete ON public.vehicle_inspection_items FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')));--> statement-breakpoint

CREATE POLICY vehicle_inspection_photos_member_select ON public.vehicle_inspection_photos FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')));--> statement-breakpoint
CREATE POLICY vehicle_inspection_photos_member_insert ON public.vehicle_inspection_photos FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')));--> statement-breakpoint
CREATE POLICY vehicle_inspection_photos_member_update ON public.vehicle_inspection_photos FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')))
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')));--> statement-breakpoint
CREATE POLICY vehicle_inspection_photos_member_delete ON public.vehicle_inspection_photos FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')));--> statement-breakpoint

REVOKE ALL ON TABLE public.vehicle_inspections, public.vehicle_inspection_items, public.vehicle_inspection_photos FROM anon;--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.vehicle_inspections, public.vehicle_inspection_items, public.vehicle_inspection_photos FROM authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.vehicle_inspections, public.vehicle_inspection_items, public.vehicle_inspection_photos TO authenticated;
