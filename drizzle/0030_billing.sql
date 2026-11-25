CREATE TABLE "tenant_billing" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"stripe_customer_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"subscription_status" varchar(40),
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"stripe_event_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_billing_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
ALTER TABLE "tenant_billing" ADD CONSTRAINT "tenant_billing_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Members read their workshop's billing state (the app shows it and locks the app after the trial).
-- Nobody writes it directly: only the functions below.
ALTER TABLE public.tenant_billing ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.tenant_billing FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_billing_member_select ON public.tenant_billing FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members AS tm WHERE tm.user_id = (SELECT auth.uid()) AND tm.deactivated_at IS NULL));--> statement-breakpoint
REVOKE ALL ON TABLE public.tenant_billing FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT ON TABLE public.tenant_billing TO authenticated;--> statement-breakpoint

-- The Stripe webhook has no logged-in user. It runs as this role, which can do exactly two things:
-- find the workshop of a Stripe customer and store a subscription update. No login, no table rights,
-- not reachable through the Data API (authenticator is not a member).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_webhook') THEN
    CREATE ROLE billing_webhook NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint
GRANT billing_webhook TO postgres;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO billing_webhook;--> statement-breakpoint

CREATE FUNCTION public.billing_tenant_for_customer(p_customer text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT b.tenant_id FROM public.tenant_billing AS b WHERE b.stripe_customer_id = p_customer
$$;--> statement-breakpoint
ALTER FUNCTION public.billing_tenant_for_customer(text) OWNER TO postgres;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.billing_tenant_for_customer(text) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.billing_tenant_for_customer(text) TO billing_webhook;--> statement-breakpoint

-- Mirrors one Stripe subscription state. Events can arrive late or twice: an event older than the
-- last applied one is ignored (returns false). Workshops without a row (pilot) get one.
CREATE FUNCTION public.apply_stripe_billing(
  p_tenant uuid,
  p_customer text,
  p_subscription text,
  p_status text,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_event_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_tenant IS NULL OR p_customer IS NULL OR p_customer !~ '^cus_[A-Za-z0-9]+$' OR p_event_at IS NULL
     OR (p_subscription IS NOT NULL AND p_subscription !~ '^sub_[A-Za-z0-9]+$')
     OR p_status NOT IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused') THEN
    RAISE EXCEPTION 'invalid billing update' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants AS t WHERE t.id = p_tenant) THEN
    RAISE EXCEPTION 'unknown workshop' USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.tenant_billing AS b (tenant_id, stripe_customer_id, stripe_subscription_id, subscription_status,
    current_period_end, cancel_at_period_end, stripe_event_at, updated_at)
  VALUES (p_tenant, p_customer, p_subscription, p_status, p_period_end, coalesce(p_cancel_at_period_end, false), p_event_at, now())
  ON CONFLICT (tenant_id) DO UPDATE SET
    stripe_customer_id = EXCLUDED.stripe_customer_id,
    stripe_subscription_id = EXCLUDED.stripe_subscription_id,
    subscription_status = EXCLUDED.subscription_status,
    current_period_end = EXCLUDED.current_period_end,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    stripe_event_at = EXCLUDED.stripe_event_at,
    updated_at = now()
  WHERE b.stripe_event_at IS NULL OR b.stripe_event_at <= EXCLUDED.stripe_event_at;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END
$$;--> statement-breakpoint
ALTER FUNCTION public.apply_stripe_billing(uuid, text, text, text, timestamptz, boolean, timestamptz) OWNER TO postgres;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.apply_stripe_billing(uuid, text, text, text, timestamptz, boolean, timestamptz) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.apply_stripe_billing(uuid, text, text, text, timestamptz, boolean, timestamptz) TO billing_webhook;--> statement-breakpoint

-- Self-registered workshops start with a 30-day trial (same function as 0029 plus the billing row).
CREATE OR REPLACE FUNCTION public.register_workshop(p_name text)
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

  PERFORM pg_advisory_xact_lock(hashtext('register_workshop:' || v_user::text));
  IF EXISTS (SELECT 1 FROM public.tenant_members AS m WHERE m.user_id = v_user) THEN
    RAISE EXCEPTION 'Dieses Konto gehört bereits zu einer Werkstatt.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.tenants (name, terms_accepted_at) VALUES (v_name, now()) RETURNING id INTO v_tenant;
  INSERT INTO public.tenant_members (tenant_id, user_id, role) VALUES (v_tenant, v_user, 'owner');
  INSERT INTO public.tenant_profiles (tenant_id, company_name) VALUES (v_tenant, v_name);
  INSERT INTO public.tenant_billing (tenant_id, trial_ends_at) VALUES (v_tenant, now() + interval '30 days');
  RETURN v_tenant;
END
$$;
