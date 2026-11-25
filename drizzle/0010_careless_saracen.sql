ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "duration_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "bay" varchar(120) DEFAULT 'Direktannahme' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "mechanic_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_members_tenant_user_unique" ON "tenant_members" USING btree ("tenant_id","user_id");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_mechanic_fk" FOREIGN KEY ("tenant_id","mechanic_id") REFERENCES "public"."tenant_members"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_duration_minutes_positive" CHECK ("appointments"."duration_minutes" > 0);--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.appointment_start(d date, t text)
RETURNS timestamp
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT d + t::time $$;--> statement-breakpoint
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_tenant_bay_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    bay WITH =,
    tsrange(
      public.appointment_start("date", "time"),
      public.appointment_start("date", "time") + duration_minutes * interval '1 minute',
      '[)'
    ) WITH &&
  )
  WHERE (bay <> 'Direktannahme');--> statement-breakpoint
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_tenant_mechanic_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    mechanic_id WITH =,
    tsrange(
      public.appointment_start("date", "time"),
      public.appointment_start("date", "time") + duration_minutes * interval '1 minute',
      '[)'
    ) WITH &&
  )
  WHERE (mechanic_id IS NOT NULL);--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.get_tenant_mechanics(p_tenant_id uuid)
RETURNS TABLE (user_id uuid, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    member.user_id,
    'Mechaniker ' || right(member.user_id::text, 8)
  FROM public.tenant_members AS member
  WHERE member.tenant_id = p_tenant_id
    AND member.role = 'mechanic'
    AND EXISTS (
      SELECT 1
      FROM public.tenant_members AS current_member
      WHERE current_member.tenant_id = p_tenant_id
        AND current_member.user_id = (SELECT auth.uid())
    )
  ORDER BY member.created_at, member.user_id
$function$;--> statement-breakpoint
ALTER FUNCTION public.get_tenant_mechanics(uuid) OWNER TO postgres;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.get_tenant_mechanics(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.get_tenant_mechanics(uuid) TO authenticated;--> statement-breakpoint