ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.tenant_members FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.tenant_profiles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.tenant_profiles FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vehicles FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.work_orders FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.work_order_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.work_order_lines FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.invoice_lines FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.invoice_sequences FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY tenants_member_select
  ON public.tenants
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
    )
  );--> statement-breakpoint

CREATE POLICY tenants_owner_update
  ON public.tenants
  FOR UPDATE
  TO authenticated
  USING (
    id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role = 'owner'
    )
  )
  WITH CHECK (
    id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role = 'owner'
    )
  );--> statement-breakpoint

CREATE POLICY tenant_members_self_select
  ON public.tenant_members
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));--> statement-breakpoint

CREATE POLICY tenant_profiles_owner_office_select
  ON public.tenant_profiles
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint

CREATE POLICY tenant_profiles_owner_office_insert
  ON public.tenant_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint

CREATE POLICY tenant_profiles_owner_office_update
  ON public.tenant_profiles
  FOR UPDATE
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

CREATE POLICY customers_owner_office_select
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint

CREATE POLICY customers_owner_office_insert
  ON public.customers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint

CREATE POLICY customers_owner_office_update
  ON public.customers
  FOR UPDATE
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

CREATE POLICY customers_mechanic_select
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role = 'mechanic'
    )
  );--> statement-breakpoint

CREATE POLICY vehicles_owner_office_select
  ON public.vehicles
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint

CREATE POLICY vehicles_owner_office_insert
  ON public.vehicles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint

CREATE POLICY vehicles_owner_office_update
  ON public.vehicles
  FOR UPDATE
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

CREATE POLICY vehicles_mechanic_select
  ON public.vehicles
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role = 'mechanic'
    )
  );--> statement-breakpoint

CREATE POLICY work_orders_tenant_select
  ON public.work_orders
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office', 'mechanic')
    )
  );--> statement-breakpoint

CREATE POLICY work_orders_tenant_insert
  ON public.work_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office', 'mechanic')
    )
  );--> statement-breakpoint

CREATE POLICY work_orders_tenant_update
  ON public.work_orders
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office', 'mechanic')
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office', 'mechanic')
    )
  );--> statement-breakpoint

CREATE POLICY work_orders_owner_office_delete
  ON public.work_orders
  FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint

CREATE POLICY work_order_lines_tenant_select
  ON public.work_order_lines
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office', 'mechanic')
    )
  );--> statement-breakpoint

CREATE POLICY work_order_lines_tenant_insert
  ON public.work_order_lines
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office', 'mechanic')
    )
  );--> statement-breakpoint

CREATE POLICY work_order_lines_tenant_update
  ON public.work_order_lines
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office', 'mechanic')
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office', 'mechanic')
    )
  );--> statement-breakpoint

CREATE POLICY work_order_lines_owner_office_delete
  ON public.work_order_lines
  FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint

CREATE POLICY invoices_owner_office_select
  ON public.invoices
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint

CREATE POLICY invoices_owner_office_insert
  ON public.invoices
  FOR INSERT
  TO authenticated
  WITH CHECK (
    status = 'draft'
    AND number IS NULL
    AND issued_at IS NULL
    AND cancels_invoice_id IS NULL
    AND tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint

CREATE POLICY invoices_owner_office_update_draft
  ON public.invoices
  FOR UPDATE
  TO authenticated
  USING (
    status = 'draft'
    AND tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  )
  WITH CHECK (
    status = 'draft'
    AND number IS NULL
    AND issued_at IS NULL
    AND tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint

CREATE POLICY invoices_owner_office_delete_draft
  ON public.invoices
  FOR DELETE
  TO authenticated
  USING (
    status = 'draft'
    AND tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint

CREATE POLICY invoice_lines_owner_office_select
  ON public.invoice_lines
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint

CREATE POLICY invoice_lines_owner_office_insert_draft
  ON public.invoice_lines
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
    AND EXISTS (
      SELECT 1
      FROM public.invoices AS i
      WHERE i.id = invoice_lines.invoice_id
        AND i.tenant_id = invoice_lines.tenant_id
        AND i.status = 'draft'
    )
  );--> statement-breakpoint

CREATE POLICY invoice_lines_owner_office_update_draft
  ON public.invoice_lines
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
    AND EXISTS (
      SELECT 1
      FROM public.invoices AS i
      WHERE i.id = invoice_lines.invoice_id
        AND i.tenant_id = invoice_lines.tenant_id
        AND i.status = 'draft'
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
    AND EXISTS (
      SELECT 1
      FROM public.invoices AS i
      WHERE i.id = invoice_lines.invoice_id
        AND i.tenant_id = invoice_lines.tenant_id
        AND i.status = 'draft'
    )
  );--> statement-breakpoint

CREATE POLICY invoice_lines_owner_office_delete_draft
  ON public.invoice_lines
  FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
    AND EXISTS (
      SELECT 1
      FROM public.invoices AS i
      WHERE i.id = invoice_lines.invoice_id
        AND i.tenant_id = invoice_lines.tenant_id
        AND i.status = 'draft'
    )
  );--> statement-breakpoint

CREATE POLICY payments_owner_office_select
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint

CREATE POLICY payments_owner_office_insert
  ON public.payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint

CREATE POLICY audit_log_owner_office_select
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id
      FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.role IN ('owner', 'office')
    )
  );--> statement-breakpoint

REVOKE ALL ON TABLE
  public.tenants,
  public.tenant_members,
  public.tenant_profiles,
  public.customers,
  public.vehicles,
  public.work_orders,
  public.work_order_lines,
  public.invoices,
  public.invoice_lines,
  public.invoice_sequences,
  public.payments,
  public.audit_log
FROM anon;--> statement-breakpoint

REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.tenants,
  public.tenant_members,
  public.tenant_profiles,
  public.customers,
  public.vehicles,
  public.work_orders,
  public.work_order_lines,
  public.invoices,
  public.invoice_lines,
  public.invoice_sequences,
  public.payments,
  public.audit_log
FROM authenticated;--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;--> statement-breakpoint
