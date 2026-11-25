REVOKE ALL ON FUNCTION public.get_tenant_mechanics(uuid) FROM anon;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE public.stock_movements FROM authenticated;