CREATE TABLE "estimate_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"total_gross_cents" integer NOT NULL,
	"decision" varchar(10),
	"decided_at" timestamp with time zone,
	"signer_name" varchar(120) DEFAULT '' NOT NULL,
	"decision_note" varchar(500) DEFAULT '' NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "estimate_approvals_token_hash_format" CHECK ("estimate_approvals"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "estimate_approvals_expiry_after_creation" CHECK ("estimate_approvals"."expires_at" > "estimate_approvals"."created_at"),
	CONSTRAINT "estimate_approvals_total_not_negative" CHECK ("estimate_approvals"."total_gross_cents" >= 0),
	CONSTRAINT "estimate_approvals_decision_valid" CHECK ("estimate_approvals"."decision" IS NULL OR "estimate_approvals"."decision" IN ('approved', 'declined')),
	CONSTRAINT "estimate_approvals_decision_has_time" CHECK (("estimate_approvals"."decision" IS NULL) = ("estimate_approvals"."decided_at" IS NULL)),
	CONSTRAINT "estimate_approvals_approval_has_name" CHECK ("estimate_approvals"."decision" IS DISTINCT FROM 'approved' OR char_length(btrim("estimate_approvals"."signer_name")) >= 2)
);
--> statement-breakpoint
ALTER TABLE "estimate_approvals" ADD CONSTRAINT "estimate_approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_approvals" ADD CONSTRAINT "estimate_approvals_tenant_work_order_fk" FOREIGN KEY ("tenant_id","work_order_id") REFERENCES "public"."work_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "estimate_approvals_token_hash_unique" ON "estimate_approvals" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "estimate_approvals_work_order_idx" ON "estimate_approvals" USING btree ("tenant_id","work_order_id");--> statement-breakpoint
-- Row-level security: every active member of the workshop may see links and make one for himself.
-- Everybody else (other workshops, anon) sees nothing. Only the five answer/revoke columns can be updated.
ALTER TABLE public.estimate_approvals ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.estimate_approvals FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY estimate_approvals_member_select ON public.estimate_approvals FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')));--> statement-breakpoint
-- A link can only be created in one's own name (the answer later runs on behalf of this member) and
-- starts without any answer.
CREATE POLICY estimate_approvals_member_insert ON public.estimate_approvals FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND decision IS NULL AND decided_at IS NULL AND revoked_at IS NULL
    AND tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic'))
  );--> statement-breakpoint
CREATE POLICY estimate_approvals_member_update ON public.estimate_approvals FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')))
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office', 'mechanic')));--> statement-breakpoint
CREATE POLICY estimate_approvals_owner_office_delete ON public.estimate_approvals FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.role IN ('owner', 'office')));--> statement-breakpoint

REVOKE ALL ON TABLE public.estimate_approvals FROM anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE public.estimate_approvals TO authenticated;--> statement-breakpoint
GRANT UPDATE (decision, decided_at, signer_name, decision_note, revoked_at) ON TABLE public.estimate_approvals TO authenticated;--> statement-breakpoint

-- A new link is only allowed for a work order that is still an estimate.
CREATE FUNCTION public.estimate_approvals_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  order_status text;
BEGIN
  SELECT wo.status::text INTO order_status
  FROM public.work_orders AS wo
  WHERE wo.tenant_id = NEW.tenant_id AND wo.id = NEW.work_order_id;
  IF order_status IS DISTINCT FROM 'estimate' THEN
    RAISE EXCEPTION 'A link can only be created for a work order in status estimate.' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER estimate_approvals_before_insert BEFORE INSERT ON public.estimate_approvals
  FOR EACH ROW EXECUTE FUNCTION public.estimate_approvals_before_insert();--> statement-breakpoint

-- A decision is evidence: once made nothing changes any more. Before that only the answer columns and
-- "revoked" may change, a revoked link stays revoked, an answer needs a valid, unexpired link and can
-- only be recorded in the name of the member who made the link.
CREATE FUNCTION public.estimate_approvals_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.decision IS NOT NULL THEN
    RAISE EXCEPTION 'A decided estimate approval cannot be changed.' USING ERRCODE = '23000';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.work_order_id IS DISTINCT FROM OLD.work_order_id
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.total_gross_cents IS DISTINCT FROM OLD.total_gross_cents THEN
    RAISE EXCEPTION 'Only the answer and revoke columns of an estimate approval may be changed.' USING ERRCODE = '23000';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'A revoked link cannot be changed.' USING ERRCODE = '23000';
  END IF;
  IF NEW.decision IS NOT NULL THEN
    IF NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'A revoked link cannot be answered.' USING ERRCODE = '23000';
    END IF;
    IF now() >= OLD.expires_at THEN
      RAISE EXCEPTION 'An expired link cannot be answered.' USING ERRCODE = '23000';
    END IF;
    IF (SELECT auth.uid()) IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'An answer can only be recorded on behalf of the member who made the link.' USING ERRCODE = '23000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER estimate_approvals_before_update BEFORE UPDATE ON public.estimate_approvals
  FOR EACH ROW EXECUTE FUNCTION public.estimate_approvals_before_update();--> statement-breakpoint

CREATE FUNCTION public.estimate_approvals_before_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.decision IS NOT NULL THEN
    RAISE EXCEPTION 'A decided estimate approval cannot be deleted.' USING ERRCODE = '23000';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER estimate_approvals_before_delete BEFORE DELETE ON public.estimate_approvals
  FOR EACH ROW EXECUTE FUNCTION public.estimate_approvals_before_delete();--> statement-breakpoint
REVOKE ALL ON FUNCTION public.estimate_approvals_before_insert(), public.estimate_approvals_before_update(), public.estimate_approvals_before_delete() FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- The ONLY thing a visitor without a login may call: find a link by the hash of its secret token.
-- Read only, returns just what the server needs to continue as the member who made the link, and
-- finds nothing when that member is no longer active.
CREATE FUNCTION public.lookup_estimate_approval(p_token_hash text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  work_order_id uuid,
  created_by uuid,
  expires_at timestamp with time zone,
  decision text,
  revoked_at timestamp with time zone,
  total_gross_cents integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.tenant_id, a.work_order_id, a.created_by, a.expires_at, a.decision::text, a.revoked_at, a.total_gross_cents
  FROM public.estimate_approvals AS a
  JOIN public.tenant_members AS m
    ON m.tenant_id = a.tenant_id AND m.user_id = a.created_by AND m.deactivated_at IS NULL
  WHERE length(p_token_hash) = 64 AND a.token_hash = p_token_hash
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.lookup_estimate_approval(text) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.lookup_estimate_approval(text) TO anon;
