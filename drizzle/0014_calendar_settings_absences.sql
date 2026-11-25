CREATE TYPE "public"."absence_type" AS ENUM('Urlaub', 'Krank', 'Schule');--> statement-breakpoint
CREATE TABLE "absences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mechanic_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"type" "absence_type" NOT NULL,
	"note" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "absences_date_order" CHECK ("absences"."end_date" >= "absences"."start_date")
);
--> statement-breakpoint
ALTER TABLE "tenant_profiles" ADD COLUMN "bundesland" varchar(2) DEFAULT 'BW' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_profiles" ADD COLUMN "work_start" varchar(5) DEFAULT '08:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_profiles" ADD COLUMN "work_end" varchar(5) DEFAULT '17:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_profiles" ADD COLUMN "lunch_start" varchar(5) DEFAULT '12:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_profiles" ADD COLUMN "lunch_end" varchar(5) DEFAULT '13:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_tenant_mechanic_fk" FOREIGN KEY ("tenant_id","mechanic_id") REFERENCES "public"."tenant_members"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absences_tenant_dates_idx" ON "absences" USING btree ("tenant_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "absences_mechanic_idx" ON "absences" USING btree ("mechanic_id");--> statement-breakpoint
ALTER TABLE "tenant_profiles" ADD CONSTRAINT "tenant_profiles_bundesland_valid" CHECK ("tenant_profiles"."bundesland" IN ('BW','BY','BE','BB','HB','HH','HE','MV','NI','NW','RP','SL','SN','ST','SH','TH'));--> statement-breakpoint
ALTER TABLE "tenant_profiles" ADD CONSTRAINT "tenant_profiles_hours_format" CHECK ("tenant_profiles"."work_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND "tenant_profiles"."work_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND "tenant_profiles"."lunch_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND "tenant_profiles"."lunch_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');--> statement-breakpoint
ALTER TABLE "tenant_profiles" ADD CONSTRAINT "tenant_profiles_hours_order" CHECK ("tenant_profiles"."work_start" < "tenant_profiles"."work_end" AND "tenant_profiles"."lunch_start" <= "tenant_profiles"."lunch_end");--> statement-breakpoint
ALTER TABLE public.absences ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.absences FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY absences_tenant_select
  ON public.absences
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office', 'mechanic')
    )
  );--> statement-breakpoint
CREATE POLICY absences_owner_office_insert
  ON public.absences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint
CREATE POLICY absences_owner_office_update
  ON public.absences
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint
CREATE POLICY absences_owner_office_delete
  ON public.absences
  FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.absences TO authenticated;--> statement-breakpoint
REVOKE ALL ON TABLE public.absences FROM anon;--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.absences FROM authenticated;--> statement-breakpoint
-- Mechanics may not read tenant_profiles (it holds IBAN and tax data), but the calendar
-- needs the Bundesland and working hours. This function returns only those fields.
CREATE OR REPLACE FUNCTION public.get_tenant_calendar_settings(p_tenant_id uuid)
RETURNS TABLE (bundesland text, work_start text, work_end text, lunch_start text, lunch_end text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    profile.bundesland::text,
    profile.work_start::text,
    profile.work_end::text,
    profile.lunch_start::text,
    profile.lunch_end::text
  FROM public.tenant_profiles AS profile
  WHERE profile.tenant_id = p_tenant_id
    AND EXISTS (
      SELECT 1
      FROM public.tenant_members AS current_member
      WHERE current_member.tenant_id = p_tenant_id
        AND current_member.user_id = (SELECT auth.uid())
    )
$function$;--> statement-breakpoint
ALTER FUNCTION public.get_tenant_calendar_settings(uuid) OWNER TO postgres;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.get_tenant_calendar_settings(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.get_tenant_calendar_settings(uuid) FROM anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.get_tenant_calendar_settings(uuid) TO authenticated;
