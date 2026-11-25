-- Audit log (GoBD: changes to business records must be traceable).
-- Database triggers write one audit_log row for every insert, update and delete on the key tables.
-- Users can only read the log; nobody, not even the privileged role, can change or remove entries.

-- Who did it: the logged-in user (auth.uid()), or, for privileged operations that run without a
-- user session (issuing and cancelling invoices), the id the application sets in app.actor_id.
CREATE OR REPLACE FUNCTION public.write_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid;
  v_actor_setting text;
  v_old jsonb;
  v_new jsonb;
  v_changed jsonb;
  v_data jsonb;
  v_tenant uuid;
  v_entity_id uuid;
BEGIN
  v_actor := (SELECT auth.uid());
  IF v_actor IS NULL THEN
    v_actor_setting := current_setting('app.actor_id', true);
    IF v_actor_setting ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_actor := v_actor_setting::uuid;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    v_tenant := NEW.tenant_id;
    v_entity_id := NEW.id;
    v_data := jsonb_build_object('after', v_new);
  ELSIF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_tenant := OLD.tenant_id;
    v_entity_id := OLD.id;
    v_data := jsonb_build_object('before', v_old);
  ELSE
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    -- Only the columns that really changed, with old and new value.
    SELECT COALESCE(
      jsonb_object_agg(field.key, jsonb_build_object('old', v_old -> field.key, 'new', field.value)),
      '{}'::jsonb
    )
    INTO v_changed
    FROM jsonb_each(v_new) AS field
    WHERE v_old -> field.key IS DISTINCT FROM field.value;

    IF v_changed = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
    v_tenant := NEW.tenant_id;
    v_entity_id := NEW.id;
    v_data := jsonb_build_object('changed', v_changed);
  END IF;

  INSERT INTO public.audit_log (tenant_id, user_id, action, entity, entity_id, data)
  VALUES (v_tenant, v_actor, TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME, v_entity_id, v_data);

  RETURN NULL;
END;
$function$;--> statement-breakpoint
ALTER FUNCTION public.write_audit_log() OWNER TO postgres;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.write_audit_log() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.write_audit_log() FROM anon;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.write_audit_log() FROM authenticated;--> statement-breakpoint

CREATE TRIGGER audit_invoices
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();--> statement-breakpoint
CREATE TRIGGER audit_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();--> statement-breakpoint
CREATE TRIGGER audit_work_orders
  AFTER INSERT OR UPDATE OR DELETE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();--> statement-breakpoint
CREATE TRIGGER audit_stock_movements
  AFTER INSERT OR UPDATE OR DELETE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();--> statement-breakpoint

-- The log itself cannot be changed or emptied.
CREATE OR REPLACE FUNCTION public.forbid_audit_log_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'The audit log cannot be changed or deleted.'
    USING ERRCODE = '55000';
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.forbid_audit_log_change() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.forbid_audit_log_change() FROM anon;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.forbid_audit_log_change() FROM authenticated;--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.forbid_audit_log_change();--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.forbid_audit_log_change();--> statement-breakpoint

-- Users only read the log (the existing policy limits that to owner and office of their workshop).
REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_log FROM authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_log FROM anon;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS audit_log_tenant_created_idx
  ON public.audit_log USING btree (tenant_id, created_at DESC);
