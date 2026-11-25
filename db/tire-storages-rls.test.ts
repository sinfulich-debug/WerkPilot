import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import postgres from 'postgres';

// Integration test against a TEST database (never the main one). Skipped unless RLS_TEST_DATABASE_URL is set.
// Needs migration 0026. Creates its own workshops inside one transaction that is rolled back.
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

/** Error code of a failing statement (or null when it works). The statement is undone either way. */
async function errorCodeOf(tx: Tx, statement: () => Promise<unknown>): Promise<string | null> {
  await tx.unsafe('SAVEPOINT attempt');
  try {
    await statement();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  } finally {
    await tx.unsafe('ROLLBACK TO SAVEPOINT attempt');
  }
}

const newMember = async (tx: Tx, tenantId: string, role: 'owner' | 'office' | 'mechanic') => {
  const id = randomUUID();
  await tx`insert into auth.users (id, email, aud, role) values (${id}, ${`${role}-${id}@rls-test.invalid`}, 'authenticated', 'authenticated')`;
  await tx`insert into tenant_members (tenant_id, user_id, role) values (${tenantId}, ${id}, ${role})`;
  return id;
};

describe.skipIf(!databaseUrl)('tire storage row-level security', () => {
  it('lets owner and office store, mechanics only read, keeps other workshops out and allows one set per slot', async () => {
    const sql = postgres(databaseUrl as string, { max: 1, onnotice: () => {} });
    const found: Record<string, unknown> = {};

    try {
      await sql.begin(async (tx) => {
        const [tenant] = await tx`insert into tenants (name) values ('RLS TEST TIRES') returning id`;
        const tenantId = tenant.id as string;
        const ownerId = await newMember(tx, tenantId, 'owner');
        const officeId = await newMember(tx, tenantId, 'office');
        const mechanicId = await newMember(tx, tenantId, 'mechanic');
        const [otherTenant] = await tx`insert into tenants (name) values ('RLS TEST TIRES OTHER') returning id`;
        const otherOwnerId = await newMember(tx, otherTenant.id as string, 'owner');
        const [customer] = await tx`insert into customers (tenant_id, name) values (${tenantId}, 'Reifen Kunde') returning id`;
        const customerId = customer.id as string;

        const insertSet = (slot: string, userTx = tx) =>
          userTx`insert into tire_storages (tenant_id, customer_id, slot, season, description, stored_at)
            values (${tenantId}, ${customerId}, ${slot}, 'winter', '205/55 R16', '2026-04-20') returning id`;

        // ---- owner and office store sets ----
        await asUser(tx, ownerId, async () => {
          found.ownerInsert = (await insertSet('A-1')).length;
        });
        await asUser(tx, officeId, async () => {
          found.officeInsert = (await insertSet('A-2')).length;
        });

        // ---- the mechanic reads (fetches the wheels) but cannot store or change ----
        await asUser(tx, mechanicId, async () => {
          found.mechanicSees = (await tx`select id from tire_storages where tenant_id = ${tenantId}`).length;
          found.mechanicInsertCode = await errorCodeOf(tx, () => insertSet('A-3'));
          found.mechanicUpdate = (await tx`update tire_storages set notes = 'x' where tenant_id = ${tenantId} returning id`).length;
        });

        // ---- one active set per slot, a released slot can be used again ----
        await asUser(tx, ownerId, async () => {
          found.duplicateSlotCode = await errorCodeOf(tx, () => insertSet('A-1'));
          await tx`update tire_storages set released_at = '2026-10-01' where tenant_id = ${tenantId} and slot = 'A-1'`;
          found.reuseAfterRelease = (await insertSet('A-1')).length;
          found.invalidSeasonCode = await errorCodeOf(
            tx,
            () => tx`insert into tire_storages (tenant_id, customer_id, slot, season, description, stored_at)
              values (${tenantId}, ${customerId}, 'B-1', 'spring', 'x', '2026-04-20')`,
          );
          found.deleteCode = await errorCodeOf(tx, () => tx`delete from tire_storages where tenant_id = ${tenantId}`);
        });

        // ---- another workshop sees nothing and cannot write into this one ----
        await asUser(tx, otherOwnerId, async () => {
          found.otherSees = (await tx`select id from tire_storages where tenant_id = ${tenantId}`).length;
          found.otherInsertCode = await errorCodeOf(tx, () => insertSet('Z-9'));
        });

        // ---- anon has no access at all ----
        await tx.unsafe('SET LOCAL ROLE anon');
        found.anonCode = await errorCodeOf(tx, () => tx`select id from tire_storages`);
        await tx.unsafe('RESET ROLE');

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    } finally {
      await sql.end();
    }

    expect(found.ownerInsert).toBe(1);
    expect(found.officeInsert).toBe(1);
    expect(found.mechanicSees).toBe(2);
    expect(found.mechanicInsertCode).toBe('42501');
    expect(found.mechanicUpdate).toBe(0);
    expect(found.duplicateSlotCode).toBe('23505');
    expect(found.reuseAfterRelease).toBe(1);
    expect(found.invalidSeasonCode).toBe('23514');
    expect(found.deleteCode).toBe('42501');
    expect(found.otherSees).toBe(0);
    expect(found.otherInsertCode).toBe('42501');
    expect(found.anonCode).toBe('42501');
  });
});
