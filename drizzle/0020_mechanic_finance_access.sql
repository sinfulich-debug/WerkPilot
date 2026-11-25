-- Mechanics may work with invoices and payments (decision of the workshop owner, 2026-11-18):
-- the boss should not be pulled in for every invoice. Same pattern as customers_mechanic_select (0001):
-- extra permissive policies for the role 'mechanic'; the existing owner/office policies stay untouched.
--
-- What a mechanic still can NOT do:
--  * read the audit log (audit_log keeps its owner/office policy),
--  * change the workshop profile (only SELECT is added: invoices need the seller data),
--  * manage staff.
-- Immutability of issued invoices is not a matter of roles: the GoBD triggers (0011) and the draft-only
-- conditions below apply to everybody. Issuing and cancelling run through the privileged function in the app.

-- invoices -------------------------------------------------------------------
CREATE POLICY invoices_mechanic_select
  ON public.invoices
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.role = 'mechanic'
    )
  );--> statement-breakpoint
CREATE POLICY invoices_mechanic_insert
  ON public.invoices
  FOR INSERT
  TO authenticated
  WITH CHECK (
    status = 'draft'
    AND number IS NULL
    AND issued_at IS NULL
    AND cancels_invoice_id IS NULL
    AND tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.role = 'mechanic'
    )
  );--> statement-breakpoint
CREATE POLICY invoices_mechanic_update_draft
  ON public.invoices
  FOR UPDATE
  TO authenticated
  USING (
    status = 'draft'
    AND tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.role = 'mechanic'
    )
  )
  WITH CHECK (
    status = 'draft'
    AND number IS NULL
    AND issued_at IS NULL
    AND tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.role = 'mechanic'
    )
  );--> statement-breakpoint
CREATE POLICY invoices_mechanic_delete_draft
  ON public.invoices
  FOR DELETE
  TO authenticated
  USING (
    status = 'draft'
    AND tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.role = 'mechanic'
    )
  );--> statement-breakpoint

-- invoice_lines --------------------------------------------------------------
CREATE POLICY invoice_lines_mechanic_select
  ON public.invoice_lines
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.role = 'mechanic'
    )
  );--> statement-breakpoint
CREATE POLICY invoice_lines_mechanic_insert_draft
  ON public.invoice_lines
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.role = 'mechanic'
    )
    AND EXISTS (
      SELECT 1 FROM public.invoices AS i
      WHERE i.id = invoice_lines.invoice_id AND i.tenant_id = invoice_lines.tenant_id AND i.status = 'draft'
    )
  );--> statement-breakpoint
CREATE POLICY invoice_lines_mechanic_update_draft
  ON public.invoice_lines
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.role = 'mechanic'
    )
    AND EXISTS (
      SELECT 1 FROM public.invoices AS i
      WHERE i.id = invoice_lines.invoice_id AND i.tenant_id = invoice_lines.tenant_id AND i.status = 'draft'
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.role = 'mechanic'
    )
    AND EXISTS (
      SELECT 1 FROM public.invoices AS i
      WHERE i.id = invoice_lines.invoice_id AND i.tenant_id = invoice_lines.tenant_id AND i.status = 'draft'
    )
  );--> statement-breakpoint
CREATE POLICY invoice_lines_mechanic_delete_draft
  ON public.invoice_lines
  FOR DELETE
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.role = 'mechanic'
    )
    AND EXISTS (
      SELECT 1 FROM public.invoices AS i
      WHERE i.id = invoice_lines.invoice_id AND i.tenant_id = invoice_lines.tenant_id AND i.status = 'draft'
    )
  );--> statement-breakpoint

-- payments (insert and read only, like for office) -----------------------------
CREATE POLICY payments_mechanic_select
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.role = 'mechanic'
    )
  );--> statement-breakpoint
CREATE POLICY payments_mechanic_insert
  ON public.payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.role = 'mechanic'
    )
  );--> statement-breakpoint

-- workshop profile: read only (seller data on invoices) ------------------------
CREATE POLICY tenant_profiles_mechanic_select
  ON public.tenant_profiles
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tm.tenant_id FROM public.tenant_members AS tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.role = 'mechanic'
    )
  );
