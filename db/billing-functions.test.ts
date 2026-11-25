import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

// Integration test of migration 0030 (tenant_billing, role billing_webhook) against a TEST database
// (never the main one). Skipped unless RLS_TEST_DATABASE_URL is set. One transaction, rolled back.
const databaseUrl = process.env.RLS_TEST_DATABASE_URL;

class Rollback extends Error {}

describe.skipIf(!databaseUrl)('billing in the database', () => {
  it('starts the trial on registration, lets only the webhook role store Stripe states, keeps the newest', async () => {
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
        const asWebhook = async <T>(fn: () => Promise<T>): Promise<T> => {
          await tx.unsafe('SET LOCAL ROLE billing_webhook');
          // on failure the caller rolls back to its savepoint, which also undoes SET LOCAL ROLE
          const result = await fn();
          await tx.unsafe('RESET ROLE');
          return result;
        };
        const refused = async (fn: () => Promise<unknown>, pattern: RegExp) => {
          await tx`savepoint s`;
          await expect(fn()).rejects.toThrow(pattern);
          await tx`rollback to savepoint s`;
        };
        const apply = (tenant: string, status: string, eventAt: string) =>
          tx`select public.apply_stripe_billing(${tenant}::uuid, 'cus_IT1', 'sub_IT1', ${status}, now() + interval '30 days', false, ${eventAt}::timestamptz) as applied`;

        const owner = randomUUID();
        await tx`insert into auth.users (id, email, aud, role, email_confirmed_at) values (${owner}, ${`o-${owner}@it.invalid`}, 'authenticated', 'authenticated', now())`;
        const [{ id: tenant }] = await asUser(owner, () => tx`select public.register_workshop('IT Abo GmbH') as id`);

        // trial of about 30 days, visible to the member, not writable
        const [billing] = await asUser(owner, () => tx`select trial_ends_at, subscription_status from tenant_billing where tenant_id = ${tenant}`);
        const days = (new Date(billing.trial_ends_at).getTime() - Date.now()) / 86_400_000;
        expect(days).toBeGreaterThan(29.9);
        expect(days).toBeLessThan(30.1);
        expect(billing.subscription_status).toBeNull();
        await refused(() => asUser(owner, () => tx`update tenant_billing set subscription_status = 'active' where tenant_id = ${tenant}`), /permission denied/);
        await refused(() => asUser(owner, () => apply(tenant, 'active', '2026-11-19T10:00:00Z')), /permission denied/);

        // the webhook role stores states, ignores older events, and cannot read tables
        expect((await asWebhook(() => apply(tenant, 'active', '2026-11-19T10:00:00Z')))[0].applied).toBe(true);
        expect((await asWebhook(() => apply(tenant, 'canceled', '2026-11-19T09:00:00Z')))[0].applied).toBe(false);
        const [found] = await asWebhook(() => tx`select public.billing_tenant_for_customer('cus_IT1') as tenant_id`);
        expect(found.tenant_id).toBe(tenant);
        const [after] = await tx`select subscription_status, stripe_customer_id from tenant_billing where tenant_id = ${tenant}`;
        expect(after).toEqual({ subscription_status: 'active', stripe_customer_id: 'cus_IT1' });
        await refused(() => asWebhook(() => tx`select * from tenant_billing`), /permission denied/);
        await refused(() => asWebhook(() => apply(tenant, 'bogus', '2026-11-19T11:00:00Z')), /invalid billing update/);

        // anon cannot call either function
        await refused(async () => {
          await tx.unsafe('SET LOCAL ROLE anon');
          await tx`select public.billing_tenant_for_customer('cus_IT1')`;
        }, /permission denied/);

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    } finally {
      await client.end();
    }
  });
});
