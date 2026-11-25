ALTER TABLE "customers" ADD COLUMN "reminder_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "reminder_consent_source" varchar(10);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "reminder_opt_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_reminder_consent_source_valid" CHECK ("customers"."reminder_consent_source" IS NULL OR "customers"."reminder_consent_source" IN ('verbal','written','form'));--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_reminder_consent_source_required" CHECK (("customers"."reminder_consent_at" IS NULL) = ("customers"."reminder_consent_source" IS NULL));