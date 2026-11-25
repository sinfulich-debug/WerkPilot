-- Names for the change log (Änderungsprotokoll), so it shows WHO did something instead of "Mitarbeiter".
-- Row-level security lets an office user see only their own tenant_members row, so the log page cannot
-- simply join the table. This function returns the names of ALL members of the workshop (deactivated
-- ones included: old log entries must keep their author), but only to the same people who may read the
-- log: active owner or office of that workshop. Same pattern as get_tenant_mechanics / is_tenant_owner.
CREATE OR REPLACE FUNCTION public.get_tenant_member_names(p_tenant_id uuid)
RETURNS TABLE (member_id uuid, user_id uuid, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT member.id, member.user_id, member.display_name::text
  FROM public.tenant_members AS member
  WHERE member.tenant_id = p_tenant_id
    AND EXISTS (
      SELECT 1
      FROM public.tenant_members AS reader
      WHERE reader.tenant_id = p_tenant_id
        AND reader.user_id = (SELECT auth.uid())
        AND reader.role IN ('owner', 'office')
        AND reader.deactivated_at IS NULL
    )
  ORDER BY member.created_at, member.id
$function$;--> statement-breakpoint
ALTER FUNCTION public.get_tenant_member_names(uuid) OWNER TO postgres;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.get_tenant_member_names(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.get_tenant_member_names(uuid) FROM anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.get_tenant_member_names(uuid) TO authenticated;
