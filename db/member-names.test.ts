import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import postgres from 'postgres';

// Integration test against a TEST database (never the main one). Skipped unless RLS_TEST_DATABASE_URL is set.
// Needs migration 0021 and one workshop with an active owner. One transaction, rolled back at the end.
const databaseUrl = process.env.RLS_TEST_DATABASE_URL;

class Rollback extends Error {}
type Tx = postgres.TransactionSql;

async function asUser<T>(tx: Tx, userId: string, fn: () => Promise<T>): Promise<T> {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`;
  await tx.unsafe('SET LOCAL ROLE authenticated');
  try {
    return await fn();
  } finally {
    await tx.unsafe('RESET ROLE');
  }
}

const newUser = async (tx: Tx, label: string) => {
  const id = randomUUID();
  await tx`insert into auth.users (id, email, aud, role) values (${id}, ${`${label}-${id}@rls-test.invalid`}, 'authenticated', 'authenticated')`;
  return id;
};

describe.skipIf(!databaseUrl)('get_tenant_member_names (names in the change log)', () => {
  it('gives names of all members, deactivated ones included, only to active owner and office of the workshop', async () => {
    const sql = postgres(databaseUrl as string, { max: 1, onnotice: () => {} });
    const found: Record<string, unknown> = {};

    try {
      await sql.begin(async (tx) => {
        const [owner] = await tx`select tenant_id, user_id from tenant_members where role = 'owner' and deactivated_at is null limit 1`;
        if (!owner) throw new Error('The test database needs a tenant with an owner.');
        const tenantId = owner.tenant_id as string;

        const officeId = await newUser(tx, 'office');
        const mechanicId = await newUser(tx, 'mechanic');
        const formerId = await newUser(tx, 'former');
        await tx`insert into tenant_members (tenant_id, user_id, role, display_name) values (${tenantId}, ${officeId}, 'office', 'Test Büro')`;
        await tx`insert into tenant_members (tenant_id, user_id, role, display_name) values (${tenantId}, ${mechanicId}, 'mechanic', 'Test Mechaniker')`;
        await tx`insert into tenant_members (tenant_id, user_id, role, display_name, deactivated_at) values (${tenantId}, ${formerId}, 'mechanic', 'Ehemaliger', now())`;

        const [otherTenant] = await tx`insert into tenants (name) values ('RLS TEST OTHER') returning id`;
        const otherOwnerId = await newUser(tx, 'other-owner');
        await tx`insert into tenant_members (tenant_id, user_id, role) values (${otherTenant.id}, ${otherOwnerId}, 'owner')`;

        const names = async () =>
          (await tx`select display_name from public.get_tenant_member_names(${tenantId})`).map((row) => row.display_name as string | null);

        await asUser(tx, owner.user_id as string, async () => (found.owner = await names()));
        await asUser(tx, officeId, async () => (found.office = await names()));
        await asUser(tx, mechanicId, async () => (found.mechanic = await names()));
        await asUser(tx, otherOwnerId, async () => (found.foreignOwner = await names()));
        await asUser(tx, formerId, async () => (found.deactivated = await names()));

        // an office user deactivated later loses the names as well
        await tx`update tenant_members set deactivated_at = now() where user_id = ${officeId}`;
        await asUser(tx, officeId, async () => (found.officeAfterDeactivation = await names()));

        // anon may not call it at all
        await tx.unsafe('SAVEPOINT anon_try');
        try {
          await tx.unsafe('SET LOCAL ROLE anon');
          await tx`select * from public.get_tenant_member_names(${tenantId})`;
          found.anon = 'allowed';
        } catch (error) {
          found.anon = (error as { code?: string }).code;
        } finally {
          await tx.unsafe('ROLLBACK TO SAVEPOINT anon_try');
        }

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    } finally {
      await sql.end();
    }

    expect(found.owner).toEqual(expect.arrayContaining(['Test Büro', 'Test Mechaniker', 'Ehemaliger']));
    expect(found.office).toEqual(expect.arrayContaining(['Test Büro', 'Test Mechaniker', 'Ehemaliger']));
    expect(found.mechanic).toEqual([]); // mechanics do not read the log
    expect(found.foreignOwner).toEqual([]); // another workshop sees nothing of ours
    expect(found.deactivated).toEqual([]);
    expect(found.officeAfterDeactivation).toEqual([]);
    expect(found.anon).toBe('42501');
  });
});
