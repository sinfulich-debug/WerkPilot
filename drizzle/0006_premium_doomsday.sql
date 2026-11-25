CREATE TYPE "public"."appointment_status" AS ENUM('Bestätigt', 'Ausstehend', 'Abgeschlossen');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"time" varchar(5) NOT NULL,
	"customer_id" uuid,
	"vehicle_id" uuid,
	"customer" varchar(200) NOT NULL,
	"vehicle" varchar(200) NOT NULL,
	"plate" varchar(20) NOT NULL,
	"vehicle_year" integer,
	"hsn" varchar(4),
	"tsn" varchar(3),
	"vin" varchar(17),
	"engine" varchar(200),
	"tuv_interval_months" integer,
	"tuv_due_date" date,
	"reason" text NOT NULL,
	"status" "appointment_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_tenant_date_time_idx" ON "appointments" USING btree ("tenant_id","date","time");
--> statement-breakpoint
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.appointments FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY appointments_tenant_all
  ON public.appointments
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
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.appointments TO authenticated;--> statement-breakpoint
REVOKE ALL ON TABLE public.appointments FROM anon;--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.appointments FROM authenticated;--> statement-breakpoint