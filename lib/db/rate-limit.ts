import 'server-only';

import { sql } from 'drizzle-orm';
import { withAnon } from '../../db/with-anon';
import { clientAddress, rateLimitBucket, type RateLimitRule } from '../rate-limit';

/**
 * Counts one request of this client for `rule`. Returns true while the client is within the limit.
 * Runs as the database role anon, which may call only hit_public_rate_limit (no table access).
 */
export async function hitRateLimit(headers: Headers, rule: RateLimitRule): Promise<boolean> {
  const bucket = rateLimitBucket(rule.scope, clientAddress(headers));
  return withAnon(async (tx) => {
    const rows = await tx.execute<{ allowed: boolean }>(
      sql`select public.hit_public_rate_limit(${bucket}, ${rule.limit}, ${rule.windowSeconds}) as allowed`,
    );
    return rows[0]?.allowed === true;
  });
}
