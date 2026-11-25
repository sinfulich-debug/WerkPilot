CREATE TYPE "public"."stock_movement_reason" AS ENUM('purchase', 'work_order', 'correction');--> statement-breakpoint
CREATE TABLE "parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sku" varchar(80) NOT NULL,
	"name" varchar(200) NOT NULL,
	"purchase_price_cents" integer NOT NULL,
	"sale_price_cents" integer NOT NULL,
	"min_stock_milli" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parts_purchase_price_nonnegative" CHECK ("parts"."purchase_price_cents" >= 0),
	CONSTRAINT "parts_sale_price_nonnegative" CHECK ("parts"."sale_price_cents" >= 0),
	CONSTRAINT "parts_min_stock_nonnegative" CHECK ("parts"."min_stock_milli" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"qty_milli" integer NOT NULL,
	"reason" "stock_movement_reason" NOT NULL,
	"work_order_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_qty_nonzero" CHECK ("stock_movements"."qty_milli" <> 0)
);
--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD COLUMN "purchase_price_cents" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "parts_tenant_id_id_unique" ON "parts" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_lines_tenant_id_id_unique" ON "work_order_lines" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_part_fk" FOREIGN KEY ("tenant_id","part_id") REFERENCES "public"."parts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_work_order_line_fk" FOREIGN KEY ("tenant_id","work_order_line_id") REFERENCES "public"."work_order_lines"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "parts_tenant_sku_unique" ON "parts" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE INDEX "parts_tenant_id_idx" ON "parts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_part_created_idx" ON "stock_movements" USING btree ("tenant_id","part_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_work_order_line_idx" ON "stock_movements" USING btree ("work_order_line_id");--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_tenant_part_fk" FOREIGN KEY ("tenant_id","part_id") REFERENCES "public"."parts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_purchase_price_nonnegative" CHECK ("work_order_lines"."purchase_price_cents" IS NULL OR "work_order_lines"."purchase_price_cents" >= 0);--> statement-breakpoint
ALTER TABLE public.parts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.parts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.stock_movements FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY parts_tenant_all
  ON public.parts
  FOR ALL
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office', 'mechanic')
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office', 'mechanic')
    )
  );--> statement-breakpoint
CREATE POLICY stock_movements_tenant_all
  ON public.stock_movements
  FOR ALL
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office', 'mechanic')
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office', 'mechanic')
    )
  );--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.parts TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stock_movements TO authenticated;--> statement-breakpoint
REVOKE ALL ON TABLE public.parts FROM anon;--> statement-breakpoint
REVOKE ALL ON TABLE public.stock_movements FROM anon;--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.parts FROM authenticated;--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.stock_movements FROM authenticated;