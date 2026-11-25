import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

// Integration test of register_workshop (migration 0029) against a TEST database (never the main one).
// Skipped unless RLS_TEST_DATABASE_URL is set. One transaction, rolled back: no users or workshops stay.
const databaseUrl = process.env.RLS_TEST_DATABASE_URL;

class Rollback extends Error {}

describe.skipIf(!databaseUrl)('register_workshop', () => {
  it('creates exactly one workshop for a confirmed user and refuses everything else', async () => {
    const client = postgres(databaseUrl as string, { max: 1, onnotice: () => {} });
    try {
      await client.begin(async (tx) => {
        const asUser = async <T>(userId: string, fn: () => Promise<T>): Promise<T> => {
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`;
          await tx.unsafe('SET LOCAL ROLE authenticated');
          // on failure the caller rolls back to its savepoint, which also undoes SET LOCAL ROLE
          const result = await fn();
          await tx.unsafe('RESET ROLE');
          return result;
        };
        const register = (name: string) => tx`select public.register_workshop(${name}) as id`;
        const failsWith = async (userId: string, name: string, code: string) => {
          await tx`savepoint s`;
          await expect(asUser(userId, () => register(name))).rejects.toMatchObject({ code });
          await tx`rollback to savepoint s`;
        };

        const confirmed = randomUUID();
        const unconfirmed = randomUUID();
        await tx`insert into auth.users (id, email, aud, role, email_confirmed_at) values (${confirmed}, ${`c-${confirmed}@it.invalid`}, 'authenticated', 'authenticated', now())`;
        await tx`insert into auth.users (id, email, aud, role) values (${unconfirmed}, ${`u-${unconfirmed}@it.invalid`}, 'authenticated', 'authenticated')`;

        await failsWith(unconfirmed, 'Kfz Test', '42501');
        await failsWith(confirmed, ' x ', '22023');

        const [{ id }] = await asUser(confirmed, () => register('  Kfz Test GmbH '));
        const [tenant] = await tx`select name, terms_accepted_at from tenants where id = ${id}`;
        expect(tenant.name).toBe('Kfz Test GmbH');
        expect(tenant.terms_accepted_at).not.toBeNull();
        const members = await tx`select role from tenant_members where tenant_id = ${id} and user_id = ${confirmed}`;
        expect(members.map((m) => m.role)).toEqual(['owner']);
        const [profile] = await tx`select company_name from tenant_profiles where tenant_id = ${id}`;
        expect(profile.company_name).toBe('Kfz Test GmbH');

        // a second workshop for the same account is refused
        await failsWith(confirmed, 'Zweite Werkstatt', '23505');

        // anon may not call it at all
        await tx`savepoint s`;
        await tx.unsafe('SET LOCAL ROLE anon');
        await expect(register('Anon GmbH')).rejects.toThrow(/permission denied/);
        await tx`rollback to savepoint s`;

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    } finally {
      await client.end();
    }
  });
});
