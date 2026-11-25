import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

// Integration test of hit_public_rate_limit (migration 0028) against a TEST database (never the main one).
// Skipped unless RLS_TEST_DATABASE_URL is set. One transaction, rolled back: no rows stay behind.
const databaseUrl = process.env.RLS_TEST_DATABASE_URL;

class Rollback extends Error {}

const BUCKET = 'a'.repeat(64);

describe.skipIf(!databaseUrl)('hit_public_rate_limit', () => {
  it('counts per bucket, refuses above the limit, and gives anon no table access', async () => {
    const client = postgres(databaseUrl as string, { max: 1, onnotice: () => {} });
    try {
      await client.begin(async (tx) => {
        await tx.unsafe('SET LOCAL ROLE anon');
        const hit = async (bucket = BUCKET, limit = 3) =>
          (await tx`select public.hit_public_rate_limit(${bucket}, ${limit}, 600) as allowed`)[0].allowed as boolean;

        expect([await hit(), await hit(), await hit()]).toEqual([true, true, true]);
        expect(await hit()).toBe(false);
        expect(await hit('b'.repeat(64))).toBe(true); // another client is not affected

        // a window that ended starts over
        await tx.unsafe('RESET ROLE');
        await tx`update public.public_rate_limits set window_start = now() - interval '11 minutes' where bucket = ${BUCKET}`;
        await tx.unsafe('SET LOCAL ROLE anon');
        expect(await hit()).toBe(true);

        // anon cannot read or write the table itself, and bad arguments are refused
        await tx`savepoint s1`;
        await expect(tx`select * from public.public_rate_limits`).rejects.toThrow(/permission denied/);
        await tx`rollback to savepoint s1`;
        await expect(tx`select public.hit_public_rate_limit('not-hex', 3, 600)`).rejects.toThrow(/invalid rate limit/);
        await tx`rollback to savepoint s1`;

        // a logged-in member cannot call it either
        await tx.unsafe('RESET ROLE');
        await tx.unsafe('SET LOCAL ROLE authenticated');
        await expect(tx`select public.hit_public_rate_limit(${BUCKET}, 3, 600)`).rejects.toThrow(/permission denied/);

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    } finally {
      await client.end();
    }
  });
});
