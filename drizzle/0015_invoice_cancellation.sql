-- Invoice cancellation (Storno, GoBD).
-- An issued invoice stays unchangeable, with one exception: it may move from "issued" to
-- "cancelled" when a numbered cancellation document that points at it already exists and
-- nothing else on the invoice changes. The cancellation is a new invoice whose
-- cancels_invoice_id references the original, with negative quantities.

-- One cancellation per invoice.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_cancellation_per_invoice
  ON public.invoices USING btree (tenant_id, cancels_invoice_id)
  WHERE cancels_invoice_id IS NOT NULL;--> statement-breakpoint

-- An invoice cannot cancel itself.
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_cancels_not_self
  CHECK (cancels_invoice_id IS NULL OR cancels_invoice_id <> id);--> statement-breakpoint

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

    -- A cancellation document may only point at an issued invoice that is not itself a cancellation.
    IF NEW.cancels_invoice_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.invoices AS original
        WHERE original.tenant_id = NEW.tenant_id
          AND original.id = NEW.cancels_invoice_id
          AND original.status = 'issued'
          AND original.cancels_invoice_id IS NULL
      ) THEN
        RAISE EXCEPTION 'Only an issued invoice that is not a cancellation can be cancelled.'
          USING ERRCODE = '55000';
      END IF;
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

  -- The one allowed change of an issued invoice: it is cancelled by an issued cancellation document.
  IF OLD.status = 'issued'
     AND NEW.status = 'cancelled'
     AND OLD.cancels_invoice_id IS NULL
     AND to_jsonb(NEW) - 'status' = to_jsonb(OLD) - 'status'
     AND EXISTS (
       SELECT 1
       FROM public.invoices AS cancellation
       WHERE cancellation.tenant_id = OLD.tenant_id
         AND cancellation.cancels_invoice_id = OLD.id
         AND cancellation.status = 'issued'
         AND cancellation.number IS NOT NULL
     ) THEN
    RETURN NEW;
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
$function$;
