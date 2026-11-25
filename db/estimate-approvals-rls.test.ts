import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import postgres from 'postgres';

// Integration test against a TEST database (never the main one). Skipped unless RLS_TEST_DATABASE_URL is set.
// Needs migration 0024. Builds its own workshops inside one transaction that is rolled back at the end.
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

async function asAnon<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await tx.unsafe('SET LOCAL ROLE anon');
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

const newHash = () => `${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;

describe.skipIf(!databaseUrl)('estimate approvals by link: row-level security, evidence rules, anon lookup', () => {
  it('keeps links inside the workshop, makes decisions final and gives anon only the lookup', async () => {
    const sql = postgres(databaseUrl as string, { max: 1, onnotice: () => {} });
    const f: Record<string, unknown> = {};

    try {
      await sql.begin(async (tx) => {
        const [tenant] = await tx`insert into tenants (name) values ('RLS TEST APPROVALS') returning id`;
        const tenantId = tenant.id as string;
        const ownerId = await newMember(tx, tenantId, 'owner');
        const officeId = await newMember(tx, tenantId, 'office');
        const mechanicId = await newMember(tx, tenantId, 'mechanic');
        const [otherTenant] = await tx`insert into tenants (name) values ('RLS TEST APPROVALS OTHER') returning id`;
        const otherOwnerId = await newMember(tx, otherTenant.id as string, 'owner');

        const [customer] = await tx`insert into customers (tenant_id, name) values (${tenantId}, 'RLS Kunde') returning id`;
        const [vehicle] = await tx`insert into vehicles (tenant_id, customer_id, plate, make, model) values (${tenantId}, ${customer.id}, 'S-RL 9', 'VW', 'Golf') returning id`;
        const workOrder = async (number: string, status: string) => (
          (await tx`insert into work_orders (tenant_id, customer_id, vehicle_id, number, status, description)
            values (${tenantId}, ${customer.id}, ${vehicle.id}, ${number}, ${status}, 'Bremsen') returning id`)[0].id as string
        );
        const estimateId = await workOrder('RLS-1', 'estimate');
        const draftId = await workOrder('RLS-2', 'draft');

        const insertLink = (hash: string, workOrderId: string, createdBy: string, extra = '') => tx.unsafe(
          `insert into estimate_approvals (tenant_id, work_order_id, token_hash, created_by, expires_at, total_gross_cents${extra ? ', ' + extra.split('=')[0] : ''})
           values ('${tenantId}', '${workOrderId}', '${hash}', '${createdBy}', now() + interval '14 days', 11900${extra ? ', ' + extra.split('=')[1] : ''}) returning id`,
        );

        // ---- creating links ----
        const hashA = newHash();
        const hashB = newHash();
        const hashC = newHash();
        const ids: Record<string, string> = {};
        await asUser(tx, mechanicId, async () => {
          ids.a = (await insertLink(hashA, estimateId, mechanicId))[0].id as string;
          f.otherCreator = await errorCodeOf(tx, () => insertLink(newHash(), estimateId, officeId));
          f.draftOrder = await errorCodeOf(tx, () => insertLink(newHash(), draftId, mechanicId));
          f.presetDecision = await errorCodeOf(tx, () => tx.unsafe(
            `insert into estimate_approvals (tenant_id, work_order_id, token_hash, created_by, expires_at, total_gross_cents, decision, decided_at, signer_name)
             values ('${tenantId}', '${estimateId}', '${newHash()}', '${mechanicId}', now() + interval '1 day', 1, 'approved', now(), 'Max Mustermann')`,
          ));
          f.badHash = await errorCodeOf(tx, () => insertLink('not-a-hash', estimateId, mechanicId));
          f.duplicateHash = await errorCodeOf(tx, () => insertLink(hashA, estimateId, mechanicId));
        });
        await asUser(tx, officeId, async () => {
          ids.b = (await insertLink(hashB, estimateId, officeId))[0].id as string;
        });
        await asUser(tx, ownerId, async () => {
          ids.c = (await insertLink(hashC, estimateId, ownerId))[0].id as string;
          f.negativeTotal = await errorCodeOf(tx, () => tx.unsafe(
            `insert into estimate_approvals (tenant_id, work_order_id, token_hash, created_by, expires_at, total_gross_cents) values ('${tenantId}', '${estimateId}', '${newHash()}', '${ownerId}', now() + interval '1 day', -1)`,
          ));
          f.expiryBeforeCreation = await errorCodeOf(tx, () => tx.unsafe(
            `insert into estimate_approvals (tenant_id, work_order_id, token_hash, created_by, expires_at, total_gross_cents) values ('${tenantId}', '${estimateId}', '${newHash()}', '${ownerId}', now() - interval '1 day', 1)`,
          ));
        });

        // ---- visibility ----
        await asUser(tx, mechanicId, async () => {
          f.mechanicSees = (await tx`select id from estimate_approvals where tenant_id = ${tenantId}`).length;
          f.mechanicDeletes = (await tx`delete from estimate_approvals where id = ${ids.a} returning id`).length;
        });
        await asUser(tx, otherOwnerId, async () => {
          f.foreignSees = (await tx`select id from estimate_approvals where tenant_id = ${tenantId}`).length;
          f.foreignRevokes = (await tx`update estimate_approvals set revoked_at = now() where id = ${ids.a} returning id`).length;
          f.foreignInsert = await errorCodeOf(tx, () => insertLink(newHash(), estimateId, otherOwnerId));
        });

        // ---- anon: nothing from the table, only the lookup by hash ----
        await asAnon(tx, async () => {
          f.anonSelect = await errorCodeOf(tx, () => tx`select id from estimate_approvals`);
          f.anonInsert = await errorCodeOf(tx, () => insertLink(newHash(), estimateId, ownerId));
          const found = await tx`select * from lookup_estimate_approval(${hashA})`;
          f.anonLookupRows = found.length;
          f.anonLookupId = found[0]?.id === ids.a;
          f.anonLookupDecision = found[0]?.decision ?? null;
          f.anonLookupCreator = found[0]?.created_by === mechanicId;
          f.anonLookupColumns = Object.keys(found[0] ?? {}).sort().join(',');
          f.anonWrongHash = (await tx`select * from lookup_estimate_approval(${newHash()})`).length;
          f.anonShortHash = (await tx`select * from lookup_estimate_approval(${'abc'})`).length;
        });
        await asUser(tx, mechanicId, async () => {
          f.authenticatedLookup = await errorCodeOf(tx, () => tx`select * from lookup_estimate_approval(${hashA})`);
        });

        // ---- the answer: only in the name of the link's creator, with a name, and only once ----
        await asUser(tx, officeId, async () => {
          f.deciderNotCreator = await errorCodeOf(tx, () => tx`update estimate_approvals set decision = 'approved', decided_at = now(), signer_name = 'Max Mustermann' where id = ${ids.a}`);
        });
        await asUser(tx, mechanicId, async () => {
          f.noName = await errorCodeOf(tx, () => tx`update estimate_approvals set decision = 'approved', decided_at = now(), signer_name = ' x ' where id = ${ids.a}`);
          f.decisionWithoutTime = await errorCodeOf(tx, () => tx`update estimate_approvals set decision = 'declined' where id = ${ids.a}`);
          f.badDecision = await errorCodeOf(tx, () => tx`update estimate_approvals set decision = 'maybe', decided_at = now() where id = ${ids.a}`);
          f.changeTotal = await errorCodeOf(tx, () => tx`update estimate_approvals set total_gross_cents = 1 where id = ${ids.a}`);
          f.changeHash = await errorCodeOf(tx, () => tx`update estimate_approvals set token_hash = ${newHash()} where id = ${ids.a}`);
          f.changeExpiry = await errorCodeOf(tx, () => tx`update estimate_approvals set expires_at = now() + interval '99 days' where id = ${ids.a}`);
          f.decide = (await tx`update estimate_approvals set decision = 'approved', decided_at = now(), signer_name = 'Max Mustermann', decision_note = 'ok' where id = ${ids.a} returning id`).length;
          f.changeAfter = await errorCodeOf(tx, () => tx`update estimate_approvals set decision_note = 'doch nicht' where id = ${ids.a}`);
          f.flipAfter = await errorCodeOf(tx, () => tx`update estimate_approvals set decision = 'declined' where id = ${ids.a}`);
          f.revokeAfter = await errorCodeOf(tx, () => tx`update estimate_approvals set revoked_at = now() where id = ${ids.a}`);
        });
        await asUser(tx, ownerId, async () => {
          f.deleteDecided = await errorCodeOf(tx, () => tx`delete from estimate_approvals where id = ${ids.a}`);
        });
        await asAnon(tx, async () => {
          f.anonLookupAfter = (await tx`select decision from lookup_estimate_approval(${hashA})`)[0]?.decision ?? null;
        });

        // ---- revoking ----
        await asUser(tx, officeId, async () => {
          f.revoke = (await tx`update estimate_approvals set revoked_at = now() where id = ${ids.b} returning id`).length;
          f.unrevoke = await errorCodeOf(tx, () => tx`update estimate_approvals set revoked_at = null where id = ${ids.b}`);
          f.answerRevoked = await errorCodeOf(tx, () => tx`update estimate_approvals set decision = 'approved', decided_at = now(), signer_name = 'Max Mustermann' where id = ${ids.b}`);
        });
        await asUser(tx, ownerId, async () => {
          f.ownerDeletesOpen = (await tx`delete from estimate_approvals where id = ${ids.c} returning id`).length;
        });

        // ---- an expired link cannot be answered ----
        const hashD = newHash();
        const [expired] = await tx.unsafe(
          `insert into estimate_approvals (tenant_id, work_order_id, token_hash, created_by, created_at, expires_at, total_gross_cents)
           values ('${tenantId}', '${estimateId}', '${hashD}', '${mechanicId}', now() - interval '3 days', now() - interval '1 day', 1) returning id`,
        );
        await asUser(tx, mechanicId, async () => {
          f.answerExpired = await errorCodeOf(tx, () => tx`update estimate_approvals set decision = 'approved', decided_at = now(), signer_name = 'Max Mustermann' where id = ${expired.id}`);
        });

        // ---- a link of a deactivated member is not found any more ----
        await tx`update tenant_members set deactivated_at = now() where tenant_id = ${tenantId} and user_id = ${mechanicId}`;
        await asAnon(tx, async () => {
          f.lookupDeactivatedCreator = (await tx`select * from lookup_estimate_approval(${hashD})`).length;
        });

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    } finally {
      await sql.end();
    }

    // creating
    expect(f.otherCreator).toBe('42501');
    expect(f.draftOrder).toBe('23000');
    expect(f.presetDecision).toBe('42501');
    expect(f.badHash).toBe('23514');
    expect(f.duplicateHash).toBe('23505');
    expect(f.negativeTotal).toBe('23514');
    expect(f.expiryBeforeCreation).toBe('23514');
    // visibility
    expect(f.mechanicSees).toBe(3);
    expect(f.mechanicDeletes).toBe(0);
    expect(f.foreignSees).toBe(0);
    expect(f.foreignRevokes).toBe(0);
    // refused either way; the insert trigger runs before the RLS check and cannot see our work order
    expect(f.foreignInsert).toBe('23000');
    // anon
    expect(f.anonSelect).toBe('42501');
    expect(f.anonInsert).toBe('42501');
    expect(f.anonLookupRows).toBe(1);
    expect(f.anonLookupId).toBe(true);
    expect(f.anonLookupDecision).toBeNull();
    expect(f.anonLookupCreator).toBe(true);
    expect(f.anonLookupColumns).toBe('created_by,decision,expires_at,id,revoked_at,tenant_id,total_gross_cents,work_order_id');
    expect(f.anonWrongHash).toBe(0);
    expect(f.anonShortHash).toBe(0);
    expect(f.authenticatedLookup).toBe('42501');
    // the answer
    expect(f.deciderNotCreator).toBe('23000');
    expect(f.noName).toBe('23514');
    expect(f.decisionWithoutTime).toBe('23514');
    expect(f.badDecision).toBe('23514');
    expect(f.changeTotal).toBe('42501'); // no column privilege
    expect(f.changeHash).toBe('42501');
    expect(f.changeExpiry).toBe('42501');
    expect(f.decide).toBe(1);
    expect(f.changeAfter).toBe('23000');
    expect(f.flipAfter).toBe('23000');
    expect(f.revokeAfter).toBe('23000');
    expect(f.deleteDecided).toBe('23000');
    expect(f.anonLookupAfter).toBe('approved');
    // revoking, expiry, deactivated creator
    expect(f.revoke).toBe(1);
    expect(f.unrevoke).toBe('23000');
    expect(f.answerRevoked).toBe('23000');
    expect(f.ownerDeletesOpen).toBe(1);
    expect(f.answerExpired).toBe('23000');
    expect(f.lookupDeactivatedCreator).toBe(0);
  });
});
