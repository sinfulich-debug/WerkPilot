CREATE TABLE "public_rate_limits" (
	"bucket" varchar(64) PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer NOT NULL,
	CONSTRAINT "public_rate_limits_bucket_hex" CHECK ("public_rate_limits"."bucket" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "public_rate_limits_hits_positive" CHECK ("public_rate_limits"."hits" > 0)
);
--> statement-breakpoint
CREATE INDEX "public_rate_limits_window_start_idx" ON "public_rate_limits" USING btree ("window_start");--> statement-breakpoint
-- Nobody reads or writes the table directly: RLS on and forced, no policies, no grants.
-- Only hit_public_rate_limit (owner postgres) touches it.
ALTER TABLE public.public_rate_limits ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.public_rate_limits FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public.public_rate_limits FROM PUBLIC, anon, authenticated;--> statement-breakpoint
-- Counts one request in a fixed window and says whether it is still allowed. Called by the public
-- approval link as the role anon. Old rows (window over a day ago) are cleaned up now and then.
CREATE FUNCTION public.hit_public_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hits integer;
BEGIN
  IF p_bucket IS NULL OR p_bucket !~ '^[0-9a-f]{64}$'
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000
     OR p_window_seconds IS NULL OR p_window_seconds NOT BETWEEN 1 AND 86400 THEN
    RAISE EXCEPTION 'invalid rate limit arguments' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.public_rate_limits AS r (bucket, window_start, hits)
  VALUES (p_bucket, now(), 1)
  ON CONFLICT (bucket) DO UPDATE SET
    window_start = CASE WHEN r.window_start <= now() - make_interval(secs => p_window_seconds) THEN now() ELSE r.window_start END,
    hits = CASE WHEN r.window_start <= now() - make_interval(secs => p_window_seconds) THEN 1 ELSE LEAST(r.hits + 1, 1000000) END
  RETURNING r.hits INTO v_hits;

  IF random() < 0.01 THEN
    DELETE FROM public.public_rate_limits WHERE window_start < now() - interval '1 day';
  END IF;

  RETURN v_hits <= p_limit;
END
$$;--> statement-breakpoint
ALTER FUNCTION public.hit_public_rate_limit(text, integer, integer) OWNER TO postgres;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hit_public_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hit_public_rate_limit(text, integer, integer) TO anon;
