ALTER TABLE "tenant_members" ADD COLUMN "display_name" varchar(120);--> statement-breakpoint
ALTER TABLE "tenant_members" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint

-- Staff management: the owner of a workshop invites, re-roles and deactivates employees.
-- Deactivation (not deletion) keeps the audit trail intact. A deactivated member loses ALL access:
-- every other policy looks the member up in tenant_members, and the own-row policy below hides
-- deactivated rows, so those lookups find nothing.

-- Helper for the owner policies. SECURITY DEFINER avoids "infinite recursion" (a policy on
-- tenant_members that reads tenant_members). Same pattern as get_tenant_mechanics.
CREATE OR REPLACE FUNCTION public.is_tenant_owner(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_members AS member
    WHERE member.tenant_id = p_tenant_id
      AND member.user_id = (SELECT auth.uid())
      AND member.role = 'owner'
      AND member.deactivated_at IS NULL
  )
$function$;--> statement-breakpoint
ALTER FUNCTION public.is_tenant_owner(uuid) OWNER TO postgres;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.is_tenant_owner(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.is_tenant_owner(uuid) FROM anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_tenant_owner(uuid) TO authenticated;--> statement-breakpoint

-- Own row: only while active.
DROP POLICY tenant_members_self_select ON public.tenant_members;--> statement-breakpoint
CREATE POLICY tenant_members_self_select
  ON public.tenant_members
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()) AND deactivated_at IS NULL);--> statement-breakpoint

-- The active owner sees and manages all members of the own workshop (including deactivated ones).
CREATE POLICY tenant_members_owner_select
  ON public.tenant_members
  FOR SELECT
  TO authenticated
  USING ((SELECT public.is_tenant_owner(tenant_id)));--> statement-breakpoint
CREATE POLICY tenant_members_owner_insert
  ON public.tenant_members
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.is_tenant_owner(tenant_id)));--> statement-breakpoint
CREATE POLICY tenant_members_owner_update
  ON public.tenant_members
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.is_tenant_owner(tenant_id)))
  WITH CHECK ((SELECT public.is_tenant_owner(tenant_id)));--> statement-breakpoint

-- Members are never deleted, and only role, name and deactivation may be changed.
REVOKE DELETE ON TABLE public.tenant_members FROM authenticated;--> statement-breakpoint
REVOKE DELETE ON TABLE public.tenant_members FROM anon;--> statement-breakpoint
REVOKE UPDATE ON TABLE public.tenant_members FROM authenticated;--> statement-breakpoint
GRANT UPDATE (role, display_name, deactivated_at) ON TABLE public.tenant_members TO authenticated;--> statement-breakpoint

-- Guard: a workshop must always keep at least one active owner; tenant and user cannot be moved.
CREATE OR REPLACE FUNCTION public.guard_tenant_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Werkstatt und Benutzer eines Mitarbeiters können nicht geändert werden.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.role = 'owner' AND OLD.deactivated_at IS NULL
     AND (NEW.role <> 'owner' OR NEW.deactivated_at IS NOT NULL) THEN
    -- Serialize concurrent changes in one workshop so two owners cannot remove each other at once.
    PERFORM pg_advisory_xact_lock(hashtext(OLD.tenant_id::text));
    IF NOT EXISTS (
      SELECT 1
      FROM public.tenant_members AS other
      WHERE other.tenant_id = OLD.tenant_id
        AND other.id <> OLD.id
        AND other.role = 'owner'
        AND other.deactivated_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Der letzte Inhaber einer Werkstatt kann nicht entfernt oder herabgestuft werden.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;--> statement-breakpoint
ALTER FUNCTION public.guard_tenant_members() OWNER TO postgres;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_tenant_members() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_tenant_members() FROM anon;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_tenant_members() FROM authenticated;--> statement-breakpoint
CREATE TRIGGER guard_tenant_members
  BEFORE UPDATE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_members();--> statement-breakpoint

-- Staff changes are part of the change log (who invited whom, who changed a role).
CREATE TRIGGER audit_tenant_members
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();--> statement-breakpoint

-- The mechanic list of the calendar: real names, and no deactivated members.
CREATE OR REPLACE FUNCTION public.get_tenant_mechanics(p_tenant_id uuid)
RETURNS TABLE (user_id uuid, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    member.user_id,
    COALESCE(NULLIF(btrim(member.display_name), ''), 'Mechaniker ' || right(member.user_id::text, 8))
  FROM public.tenant_members AS member
  WHERE member.tenant_id = p_tenant_id
    AND member.role = 'mechanic'
    AND member.deactivated_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.tenant_members AS current_member
      WHERE current_member.tenant_id = p_tenant_id
        AND current_member.user_id = (SELECT auth.uid())
        AND current_member.deactivated_at IS NULL
    )
  ORDER BY member.created_at, member.user_id
$function$;
