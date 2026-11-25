ALTER TABLE "tenants" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
-- Self-registration: a signed-up user with a confirmed e-mail and no workshop yet creates one and
-- becomes its owner. Runs with the owner's rights (postgres) because the user is not a member of any
-- workshop yet, so RLS would refuse every insert. Strict checks inside instead of a privileged client.
CREATE FUNCTION public.register_workshop(p_name text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_tenant uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet.' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 200 THEN
    RAISE EXCEPTION 'Der Werkstattname muss 2 bis 200 Zeichen lang sein.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = v_user AND u.email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Die E-Mail-Adresse ist noch nicht bestätigt.' USING ERRCODE = '42501';
  END IF;

  -- one workshop per account; also refuses former (deactivated) employees of another workshop
  PERFORM pg_advisory_xact_lock(hashtext('register_workshop:' || v_user::text));
  IF EXISTS (SELECT 1 FROM public.tenant_members AS m WHERE m.user_id = v_user) THEN
    RAISE EXCEPTION 'Dieses Konto gehört bereits zu einer Werkstatt.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.tenants (name, terms_accepted_at) VALUES (v_name, now()) RETURNING id INTO v_tenant;
  INSERT INTO public.tenant_members (tenant_id, user_id, role) VALUES (v_tenant, v_user, 'owner');
  INSERT INTO public.tenant_profiles (tenant_id, company_name) VALUES (v_tenant, v_name);
  RETURN v_tenant;
END
$$;--> statement-breakpoint
ALTER FUNCTION public.register_workshop(text) OWNER TO postgres;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.register_workshop(text) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.register_workshop(text) TO authenticated;
