import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import postgres from 'postgres';

// Integration test against a TEST database (never the main one). Skipped unless RLS_TEST_DATABASE_URL is set.
// Needs migration 0023. Creates its own workshop with three users inside one transaction that is rolled back.
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

describe.skipIf(!databaseUrl)('workshop everyday settings (hourly rate, reminder text) row-level security', () => {
  it('lets owner and office write, mechanics only read, keeps other workshops out and checks the values', async () => {
    const sql = postgres(databaseUrl as string, { max: 1, onnotice: () => {} });
    const found: Record<string, unknown> = {};

    try {
      await sql.begin(async (tx) => {
        const [tenant] = await tx`insert into tenants (name) values ('RLS TEST SETTINGS') returning id`;
        const tenantId = tenant.id as string;
        const ownerId = await newMember(tx, tenantId, 'owner');
        const officeId = await newMember(tx, tenantId, 'office');
        const mechanicId = await newMember(tx, tenantId, 'mechanic');
        const [otherTenant] = await tx`insert into tenants (name) values ('RLS TEST SETTINGS OTHER') returning id`;
        const otherOwnerId = await newMember(tx, otherTenant.id as string, 'owner');

        // ---- the owner creates the profile; the defaults apply to what is not given ----
        await asUser(tx, ownerId, async () => {
          const [created] = await tx`insert into tenant_profiles (tenant_id, company_name) values (${tenantId}, 'RLS Werkstatt') returning hourly_rate_cents, whatsapp_template`;
          found.defaultRate = created.hourly_rate_cents;
          found.defaultTemplate = created.whatsapp_template;
          // the same statement shape as saveWorkshopProfile (insert ... on conflict do update)
          const [saved] = await tx`insert into tenant_profiles (tenant_id, company_name, hourly_rate_cents, whatsapp_template)
            values (${tenantId}, 'RLS Werkstatt', 11000, 'Hallo {Kundenname}')
            on conflict (tenant_id) do update set hourly_rate_cents = excluded.hourly_rate_cents, whatsapp_template = excluded.whatsapp_template
            returning hourly_rate_cents, whatsapp_template`;
          found.ownerRate = saved.hourly_rate_cents;
          found.ownerTemplate = saved.whatsapp_template;
        });

        // ---- office may change it, too ----
        await asUser(tx, officeId, async () => {
          found.officeUpdate = (await tx`update tenant_profiles set hourly_rate_cents = 12000 where tenant_id = ${tenantId} returning id`).length;
        });

        // ---- the mechanic reads the values (for estimates and reminders) but cannot change them ----
        await asUser(tx, mechanicId, async () => {
          const rows = await tx`select hourly_rate_cents, whatsapp_template from tenant_profiles where tenant_id = ${tenantId}`;
          found.mechanicSees = rows.length;
          found.mechanicRate = rows[0]?.hourly_rate_cents;
          found.mechanicUpdate = (await tx`update tenant_profiles set hourly_rate_cents = 1 where tenant_id = ${tenantId} returning id`).length;
          found.mechanicTemplateUpdate = (await tx`update tenant_profiles set whatsapp_template = 'gehackt' where tenant_id = ${tenantId} returning id`).length;
        });
        found.rateAfterMechanic = Number((await tx`select hourly_rate_cents as n from tenant_profiles where tenant_id = ${tenantId}`)[0]?.n);

        // ---- another workshop sees and changes nothing ----
        await asUser(tx, otherOwnerId, async () => {
          found.foreignSees = (await tx`select id from tenant_profiles where tenant_id = ${tenantId}`).length;
          found.foreignUpdate = (await tx`update tenant_profiles set hourly_rate_cents = 1 where tenant_id = ${tenantId} returning id`).length;
        });

        // ---- the database itself refuses wrong values ----
        await asUser(tx, ownerId, async () => {
          found.negativeRate = await errorCodeOf(tx, () => tx`update tenant_profiles set hourly_rate_cents = -1 where tenant_id = ${tenantId}`);
          found.hugeRate = await errorCodeOf(tx, () => tx`update tenant_profiles set hourly_rate_cents = 1000001 where tenant_id = ${tenantId}`);
          found.borderRate = await errorCodeOf(tx, () => tx`update tenant_profiles set hourly_rate_cents = 1000000 where tenant_id = ${tenantId}`);
          found.zeroRate = await errorCodeOf(tx, () => tx`update tenant_profiles set hourly_rate_cents = 0 where tenant_id = ${tenantId}`);
          found.longTemplate = await errorCodeOf(tx, () => tx`update tenant_profiles set whatsapp_template = ${'x'.repeat(1001)} where tenant_id = ${tenantId}`);
          found.borderTemplate = await errorCodeOf(tx, () => tx`update tenant_profiles set whatsapp_template = ${'x'.repeat(1000)} where tenant_id = ${tenantId}`);
          found.nullTemplate = await errorCodeOf(tx, () => tx`update tenant_profiles set whatsapp_template = null where tenant_id = ${tenantId}`);
          found.nullRate = await errorCodeOf(tx, () => tx`update tenant_profiles set hourly_rate_cents = null where tenant_id = ${tenantId}`);
        });

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    } finally {
      await sql.end();
    }

    expect(found.defaultRate).toBe(9500);
    expect(found.defaultTemplate).toBeNull();
    expect(found.ownerRate).toBe(11000);
    expect(found.ownerTemplate).toBe('Hallo {Kundenname}');
    expect(found.officeUpdate).toBe(1);

    expect(found.mechanicSees).toBe(1);
    expect(found.mechanicRate).toBe(12000);
    expect(found.mechanicUpdate).toBe(0);
    expect(found.mechanicTemplateUpdate).toBe(0);
    expect(found.rateAfterMechanic).toBe(12000);

    expect(found.foreignSees).toBe(0);
    expect(found.foreignUpdate).toBe(0);

    expect(found.negativeRate).toBe('23514');
    expect(found.hugeRate).toBe('23514');
    expect(found.borderRate).toBeNull();
    expect(found.zeroRate).toBeNull();
    expect(found.longTemplate).toBe('23514');
    expect(found.borderTemplate).toBeNull();
    expect(found.nullTemplate).toBeNull();
    expect(found.nullRate).toBe('23502'); // not null
  });
});
