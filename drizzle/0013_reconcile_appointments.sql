ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS duration_minutes integer DEFAULT 60,
  ADD COLUMN IF NOT EXISTS bay varchar(120) DEFAULT 'Direktannahme',
  ADD COLUMN IF NOT EXISTS mechanic_id uuid;--> statement-breakpoint
UPDATE public.appointments
SET duration_minutes = 60
WHERE duration_minutes IS NULL;--> statement-breakpoint
UPDATE public.appointments
SET bay = 'Direktannahme'
WHERE bay IS NULL;--> statement-breakpoint
ALTER TABLE public.appointments
  ALTER COLUMN duration_minutes SET DEFAULT 60,
  ALTER COLUMN duration_minutes SET NOT NULL,
  ALTER COLUMN bay SET DEFAULT 'Direktannahme',
  ALTER COLUMN bay SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS tenant_members_tenant_user_unique
  ON public.tenant_members USING btree (tenant_id, user_id);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'appointments_tenant_mechanic_fk'
      AND conrelid = 'public.appointments'::regclass
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_tenant_mechanic_fk
      FOREIGN KEY (tenant_id, mechanic_id)
      REFERENCES public.tenant_members(tenant_id, user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'appointments_duration_minutes_positive'
      AND conrelid = 'public.appointments'::regclass
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_duration_minutes_positive
      CHECK (duration_minutes > 0);
  END IF;
END $$;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.appointment_start(d date, t text)
RETURNS timestamp
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT d + t::time $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'appointments_tenant_bay_no_overlap'
      AND conrelid = 'public.appointments'::regclass
  ) THEN
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
      WHERE (bay <> 'Direktannahme');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'appointments_tenant_mechanic_no_overlap'
      AND conrelid = 'public.appointments'::regclass
  ) THEN
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
      WHERE (mechanic_id IS NOT NULL);
  END IF;
END $$;
