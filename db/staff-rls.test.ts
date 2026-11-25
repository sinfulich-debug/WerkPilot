import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import postgres from 'postgres';

// Integration test against a TEST database (never the main one). Skipped unless RLS_TEST_DATABASE_URL is set.
// One transaction, rolled back at the end. Needs one tenant with an owner and migration 0019 applied.
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
async function errorCodeOf(tx: Tx, statement: string): Promise<string | null> {
  await tx.unsafe('SAVEPOINT attempt');
  try {
    await tx.unsafe(statement);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  } finally {
    await tx.unsafe('ROLLBACK TO SAVEPOINT attempt');
  }
}

const newUser = async (tx: Tx, label: string) => {
  const id = randomUUID();
  await tx`insert into auth.users (id, email, aud, role) values (${id}, ${`${label}-${id}@rls-test.invalid`}, 'authenticated', 'authenticated')`;
  return id;
};

describe.skipIf(!databaseUrl)('staff management (tenant_members)', () => {
  it('lets only the active owner manage staff, deactivation removes all access, last owner stays', async () => {
    const sql = postgres(databaseUrl as string, { max: 1, onnotice: () => {} });
    const found: Record<string, unknown> = {};

    try {
      await sql.begin(async (tx) => {
        const [owner] = await tx`select tenant_id, user_id from tenant_members where role = 'owner' and deactivated_at is null limit 1`;
        if (!owner) throw new Error('The test database needs a tenant with an owner.');
        const tenantId = owner.tenant_id as string;

        const officeId = await newUser(tx, 'office');
        const mechanicId = await newUser(tx, 'mechanic');
        const inviteeId = await newUser(tx, 'invitee');
        await tx`insert into tenant_members (tenant_id, user_id, role, display_name) values (${tenantId}, ${officeId}, 'office', 'Test Büro')`;
        await tx`insert into tenant_members (tenant_id, user_id, role, display_name) values (${tenantId}, ${mechanicId}, 'mechanic', 'Test Mechaniker')`;

        // A second, unrelated workshop with its own owner.
        const [otherTenant] = await tx`insert into tenants (name) values ('RLS TEST OTHER') returning id`;
        const otherOwnerId = await newUser(tx, 'other-owner');
        await tx`insert into tenant_members (tenant_id, user_id, role) values (${otherTenant.id}, ${otherOwnerId}, 'owner')`;
        await tx`insert into customers (tenant_id, name) values (${tenantId}, 'RLS TEST')`;

        const memberCount = async () => Number((await tx`select count(*)::int as n from tenant_members where tenant_id = ${tenantId}`)[0]?.n);
        const mechanicNames = async () => (await tx`select display_name from get_tenant_mechanics(${tenantId})`).map((r) => r.display_name);

        // ---- who sees the staff list ----
        await asUser(tx, owner.user_id as string, async () => {
          found.ownerSeesMembers = (await memberCount()) >= 3;
          found.mechanicListForOwner = await mechanicNames();
        });
        await asUser(tx, officeId, async () => (found.officeSeesMembers = await memberCount()));
        await asUser(tx, mechanicId, async () => (found.mechanicSeesMembers = await memberCount()));
        await asUser(tx, otherOwnerId, async () => (found.foreignOwnerSeesMembers = await memberCount()));

        // ---- who may change staff ----
        const inviteSql = `insert into tenant_members (tenant_id, user_id, role, display_name) values ('${tenantId}', '${inviteeId}', 'mechanic', 'Neu')`;
        await asUser(tx, officeId, async () => (found.officeInvite = await errorCodeOf(tx, inviteSql)));
        await asUser(tx, mechanicId, async () => {
          found.mechanicInvite = await errorCodeOf(tx, inviteSql);
          const rows = await tx`update tenant_members set role = 'owner' where user_id = ${mechanicId} returning id`;
          found.mechanicSelfPromoteRows = rows.length;
        });
        await asUser(tx, otherOwnerId, async () => (found.foreignOwnerInvite = await errorCodeOf(tx, inviteSql)));
        await asUser(tx, owner.user_id as string, async () => {
          found.ownerInvite = await errorCodeOf(tx, inviteSql);
          // tenant and user cannot be moved (column privileges)
          found.ownerMovesMember = await errorCodeOf(tx, `update tenant_members set tenant_id = '${otherTenant.id}' where user_id = '${inviteeId}'`);
          found.ownerDeletesMember = await errorCodeOf(tx, `delete from tenant_members where user_id = '${inviteeId}'`);
        });

        // ---- deactivation removes ALL access ----
        await asUser(tx, mechanicId, async () => (found.mechanicCustomersBefore = Number((await tx`select count(*)::int as n from customers`)[0]?.n)));
        await asUser(tx, owner.user_id as string, async () => {
          const rows = await tx`update tenant_members set deactivated_at = now() where user_id = ${mechanicId} returning id`;
          found.deactivatedRows = rows.length;
          found.mechanicListAfter = await mechanicNames();
        });
        await asUser(tx, mechanicId, async () => {
          found.mechanicCustomersAfter = Number((await tx`select count(*)::int as n from customers`)[0]?.n);
          found.mechanicMembershipAfter = await memberCount();
        });

        // ---- the last active owner stays ----
        await asUser(tx, owner.user_id as string, async () => {
          const others = await tx`select count(*)::int as n from tenant_members where tenant_id = ${tenantId} and role = 'owner' and deactivated_at is null and user_id <> ${owner.user_id}`;
          found.otherOwnersBefore = Number(others[0]?.n);
          found.demoteLastOwner = await errorCodeOf(tx, `update tenant_members set role = 'office' where user_id = '${owner.user_id}'`);
          found.deactivateLastOwner = await errorCodeOf(tx, `update tenant_members set deactivated_at = now() where user_id = '${owner.user_id}'`);
          // with a second owner the first one may step down
          await tx`update tenant_members set role = 'owner' where user_id = ${officeId}`;
          found.demoteWithSecondOwner = await errorCodeOf(tx, `update tenant_members set role = 'office' where user_id = '${owner.user_id}'`);
        });

        // ---- the change log records it ----
        const logged = await tx`select count(*)::int as n from audit_log where entity = 'tenant_members' and tenant_id = ${tenantId}`;
        found.auditRows = Number(logged[0]?.n);

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    } finally {
      await sql.end();
    }

    expect(found.ownerSeesMembers).toBe(true);
    expect(found.mechanicListForOwner).toContain('Test Mechaniker');
    expect(found.officeSeesMembers).toBe(1);
    expect(found.mechanicSeesMembers).toBe(1);
    expect(found.foreignOwnerSeesMembers).toBe(0); // the owner of another workshop sees none of ours

    expect(found.officeInvite).toBe('42501');
    expect(found.mechanicInvite).toBe('42501');
    expect(found.mechanicSelfPromoteRows).toBe(0);
    expect(found.foreignOwnerInvite).toBe('42501');
    expect(found.ownerInvite).toBeNull();
    expect(found.ownerMovesMember).toBe('42501');
    expect(found.ownerDeletesMember).toBe('42501');

    expect(found.mechanicCustomersBefore).toBeGreaterThanOrEqual(1);
    expect(found.deactivatedRows).toBe(1);
    expect(found.mechanicListAfter).not.toContain('Test Mechaniker');
    expect(found.mechanicCustomersAfter).toBe(0);
    expect(found.mechanicMembershipAfter).toBe(0);

    expect(found.otherOwnersBefore).toBe(0);
    expect(found.demoteLastOwner).toBe('23514');
    expect(found.deactivateLastOwner).toBe('23514');
    expect(found.demoteWithSecondOwner).toBeNull();

    expect(found.auditRows).toBeGreaterThan(0);
  });
});
