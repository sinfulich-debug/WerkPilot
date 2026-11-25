CREATE TYPE "public"."work_order_line_kind" AS ENUM('labor', 'part');--> statement-breakpoint
CREATE TYPE "public"."work_order_status" AS ENUM('draft', 'estimate', 'approved', 'in_progress', 'completed', 'invoiced');--> statement-breakpoint
ALTER TABLE "work_orders" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "work_orders" ALTER COLUMN "status" SET DATA TYPE "public"."work_order_status" USING "status"::"public"."work_order_status";--> statement-breakpoint
ALTER TABLE "work_orders" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."work_order_status";--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD COLUMN "kind" "work_order_line_kind" DEFAULT 'labor' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD COLUMN "discount_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_order_lines" ADD COLUMN "part_id" uuid;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "workstation" varchar(120) DEFAULT 'Direktannahme' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "mechanic" varchar(200) DEFAULT 'Unzugewiesen' NOT NULL;