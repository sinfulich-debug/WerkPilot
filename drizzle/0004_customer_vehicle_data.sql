ALTER TABLE "customers" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "year" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "engine" varchar(200);--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "tuv_interval_months" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "last_reminder_sent_at" date;