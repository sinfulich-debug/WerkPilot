ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_has_number_and_date" CHECK ("invoices"."status" <> 'issued' OR ("invoices"."number" IS NOT NULL AND "invoices"."issued_at" IS NOT NULL));--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_invoice_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'Invoices must be inserted as drafts.'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Issued invoices cannot be deleted.'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Issued invoices cannot be modified.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'draft' AND NEW.number IS NULL AND NEW.issued_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'issued'
     AND to_jsonb(NEW) - ARRAY['status', 'number', 'issued_at'] =
         to_jsonb(OLD) - ARRAY['status', 'number', 'issued_at'] THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only a draft invoice can be issued, without changing its contents.'
    USING ERRCODE = '55000';
END;
$function$;--> statement-breakpoint
CREATE TRIGGER invoices_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_invoice_immutability();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_invoice_is_draft(
  p_tenant_id uuid,
  p_invoice_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  invoice_state public.invoice_status;
BEGIN
  SELECT invoice.status
  INTO invoice_state
  FROM public.invoices AS invoice
  WHERE invoice.tenant_id = p_tenant_id
    AND invoice.id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND OR invoice_state <> 'draft' THEN
    RAISE EXCEPTION 'Invoice lines can only be changed while the invoice is a draft.'
      USING ERRCODE = '55000';
  END IF;
END;
$function$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_invoice_line_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.assert_invoice_is_draft(OLD.tenant_id, OLD.invoice_id);
  END IF;

  IF TG_OP = 'INSERT'
     OR (TG_OP = 'UPDATE' AND (
       OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.invoice_id IS DISTINCT FROM NEW.invoice_id
     )) THEN
    PERFORM public.assert_invoice_is_draft(NEW.tenant_id, NEW.invoice_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;--> statement-breakpoint
CREATE TRIGGER invoice_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_invoice_line_immutability();--> statement-breakpoint