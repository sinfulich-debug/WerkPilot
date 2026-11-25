CREATE TABLE "process_documentation_answers" (
	"tenant_id" uuid NOT NULL,
	"field_key" varchar(60) NOT NULL,
	"answer" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "process_documentation_answers_pk" PRIMARY KEY("tenant_id","field_key"),
	CONSTRAINT "process_documentation_answers_length" CHECK (char_length("process_documentation_answers"."answer") <= 4000),
	CONSTRAINT "process_documentation_answers_key_format" CHECK ("process_documentation_answers"."field_key" ~ '^[a-z0-9-]{1,60}$')
);
--> statement-breakpoint
ALTER TABLE "process_documentation_answers" ADD CONSTRAINT "process_documentation_answers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE public.process_documentation_answers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.process_documentation_answers FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY process_documentation_answers_owner_office_all
  ON public.process_documentation_answers
  FOR ALL
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
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.process_documentation_answers TO authenticated;--> statement-breakpoint
REVOKE ALL ON TABLE public.process_documentation_answers FROM anon;--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.process_documentation_answers FROM authenticated;
