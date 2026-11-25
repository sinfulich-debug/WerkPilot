import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import postgres from 'postgres';

// Integration test against a TEST database (never the main one). Skipped unless RLS_TEST_DATABASE_URL is set.
// One transaction, rolled back at the end: the temporary users, members and rows never stay in the database.
// Needs one tenant with an owner (e.g. the one made by `npm run tenant:create`).
const databaseUrl = process.env.RLS_TEST_DATABASE_URL;

class Rollback extends Error {}
type Tx = postgres.TransactionSql;

/** Runs `fn` as the given user with the `authenticated` role, like withUser does, then restores the superuser. */
async function asUser<T>(tx: Tx, userId: string, fn: () => Promise<T>): Promise<T> {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`;
  await tx.unsafe('SET LOCAL ROLE authenticated');
  try {
    return await fn();
  } finally {
    await tx.unsafe('RESET ROLE');
  }
}

/** Returns the Postgres error code if the statement fails, or `null` if it succeeds. The statement is undone. */
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

const count = async (tx: Tx, table: string) =>
  Number((await tx.unsafe(`select count(*)::int as n from ${table}`))[0]?.n);

describe.skipIf(!databaseUrl)('role based RLS (office, mechanic)', () => {
  it('lets each role see and change only what it should', async () => {
    const sql = postgres(databaseUrl as string, { max: 1, onnotice: () => {} });
    const found: Record<string, unknown> = {};

    try {
      await sql.begin(async (tx) => {
        const [owner] = await tx`select tenant_id, user_id from tenant_members where role = 'owner' limit 1`;
        if (!owner) throw new Error('The test database needs a tenant with an owner.');
        const tenantId = owner.tenant_id as string;

        const mechanicId = randomUUID();
        const officeId = randomUUID();
        for (const [id, role] of [
          [mechanicId, 'mechanic'],
          [officeId, 'office'],
        ] as const) {
          await tx`insert into auth.users (id, email, aud, role) values (${id}, ${`${role}-${id}@rls-test.invalid`}, 'authenticated', 'authenticated')`;
          await tx`insert into tenant_members (tenant_id, user_id, role) values (${tenantId}, ${id}, ${role})`;
        }

        // One draft invoice so the tables are not empty, whatever the test database holds.
        const [customer] = await tx`insert into customers (tenant_id, name) values (${tenantId}, 'RLS TEST') returning id`;
        await tx`insert into audit_log (tenant_id, action, entity, entity_id, data) values (${tenantId}, 'rls.test', 'rls_test', ${randomUUID()}, '{}')`;

        const pastDate = '2030-01-01';
        const absenceSql = `insert into absences (tenant_id, mechanic_id, start_date, end_date, type) values ('${tenantId}', '${mechanicId}', '${pastDate}', '${pastDate}', 'Urlaub')`;
        
        // ---- mechanic ----
        await asUser(tx, mechanicId, async () => {
          found.mechanicAudit = await count(tx, 'audit_log');
          found.mechanicCustomers = await count(tx, 'customers');
          found.mechanicProfileReadable = (await count(tx, 'tenant_profiles')) >= 1;
          found.mechanicAbsencesReadable = (await count(tx, 'absences')) >= 0;
          found.mechanicInsertAbsence = await errorCodeOf(tx, absenceSql);
          found.mechanicInsertAudit = await errorCodeOf(
            tx,
            `insert into audit_log (tenant_id, action, entity, entity_id, data) values ('${tenantId}', 'x', 'x', '${randomUUID()}', '{}')`,
          );
          // An UPDATE hidden by RLS does not fail, it changes 0 rows.
          found.mechanicCustomerUpdateRows = (await tx`update customers set name = 'HACKED' where id = ${customer.id} returning id`).length;
          found.mechanicProfileUpdateRows = (await tx`update tenant_profiles set company_name = 'HACKED' where tenant_id = ${tenantId} returning tenant_id`).length;

          // invoices: a mechanic works with drafts, like the office
          const [draft] = await tx`insert into invoices (tenant_id, customer_id, status, seller_snapshot, buyer_snapshot) values (${tenantId}, ${customer.id}, 'draft', '{}', '{}') returning id`;
          found.mechanicInvoicesReadable = (await count(tx, 'invoices')) >= 1;
          await tx`insert into invoice_lines (tenant_id, invoice_id, position, description, qty_milli, unit_price_cents, tax_rate_bp) values (${tenantId}, ${draft.id}, 1, 'Test', 1000, 1000, 1900)`;
          found.mechanicLinesReadable = (await count(tx, 'invoice_lines')) >= 1;
          found.mechanicUpdateDraftRows = (await tx`update invoices set due_date = '2030-01-31' where id = ${draft.id} returning id`).length;
          // ... but never an invoice that is already issued (GoBD): the draft-only conditions apply to every role
          found.mechanicInsertIssuedInvoice = await errorCodeOf(
            tx,
            `insert into invoices (tenant_id, customer_id, status, number, issued_at, seller_snapshot, buyer_snapshot) values ('${tenantId}', '${customer.id}', 'issued', 'X-1', now(), '{}', '{}')`,
          );
          // payments: allowed by the policy (the unknown invoice then fails on the foreign key, code 23503)
          found.mechanicPaymentsReadable = (await count(tx, 'payments')) >= 0;
          found.mechanicInsertPayment = await errorCodeOf(
            tx,
            `insert into payments (tenant_id, invoice_id, amount_cents, paid_at, method) values ('${tenantId}', '${randomUUID()}', 100, now(), 'bar')`,
          );
          found.mechanicDeleteLineRows = (await tx`delete from invoice_lines where invoice_id = ${draft.id} returning id`).length;
          found.mechanicDeleteDraftRows = (await tx`delete from invoices where id = ${draft.id} returning id`).length;
        });

        // ---- office ----
        await asUser(tx, officeId, async () => {
          found.officeAuditSeesRow = (await count(tx, 'audit_log')) > 0;
          found.officeInvoicesReadable = (await count(tx, 'invoices')) >= 0;
          found.officeProfileReadable = (await count(tx, 'tenant_profiles')) >= 1;
          found.officeInsertAbsence = await errorCodeOf(tx, absenceSql);
          found.officeInsertAudit = await errorCodeOf(
            tx,
            `insert into audit_log (tenant_id, action, entity, entity_id, data) values ('${tenantId}', 'x', 'x', '${randomUUID()}', '{}')`,
          );
          const updated = await tx`update customers set name = 'RLS TEST 2' where id = ${customer.id} returning id`;
          found.officeCustomerUpdateRows = updated.length;
        });

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    } finally {
      await sql.end();
    }

    // mechanic: works with invoices and payments (decision of the owner), but not with the log or the workshop profile
    expect(found.mechanicAudit).toBe(0);
    expect(found.mechanicInsertAudit).toBe('42501');
    expect(found.mechanicProfileReadable).toBe(true);
    expect(found.mechanicProfileUpdateRows).toBe(0);
    expect(found.mechanicInvoicesReadable).toBe(true);
    expect(found.mechanicLinesReadable).toBe(true);
    expect(found.mechanicUpdateDraftRows).toBe(1);
    expect(found.mechanicInsertIssuedInvoice).toMatch(/^(42501|55000)$/); // RLS policy or the GoBD trigger
    expect(found.mechanicPaymentsReadable).toBe(true);
    expect(found.mechanicInsertPayment).toBe('23503');
    expect(found.mechanicDeleteLineRows).toBe(1);
    expect(found.mechanicDeleteDraftRows).toBe(1);
    // mechanic: may read the calendar data and customers, but not change absences or customers
    expect(found.mechanicCustomers).toBeGreaterThanOrEqual(1);
    expect(found.mechanicAbsencesReadable).toBe(true);
    expect(found.mechanicInsertAbsence).toBe('42501');
    expect(found.mechanicCustomerUpdateRows).toBe(0);
    // office: sees the log and master data, manages absences and customers, still cannot write the log
    expect(found.officeAuditSeesRow).toBe(true);
    expect(found.officeInvoicesReadable).toBe(true);
    expect(found.officeProfileReadable).toBe(true);
    expect(found.officeInsertAbsence).toBeNull();
    expect(found.officeInsertAudit).toBe('42501');
    expect(found.officeCustomerUpdateRows).toBe(1);
  });
});
