ALTER TABLE "tenant_profiles" ADD COLUMN "calendar_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_profiles" ADD COLUMN "onboarding_dismissed_at" timestamp with time zone;--> statement-breakpoint
-- Workshops that already changed the calendar settings away from the defaults have clearly chosen them.
UPDATE "tenant_profiles" SET "calendar_confirmed_at" = now()
WHERE "bundesland" <> 'BW' OR "work_start" <> '08:00' OR "work_end" <> '17:00'
   OR "lunch_start" <> '12:00' OR "lunch_end" <> '13:00';
