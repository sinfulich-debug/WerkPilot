import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import type { SessionContext } from '../lib/session';

// Integration test against a TEST database (never the main one). Skipped unless RLS_TEST_DATABASE_URL is set.
// Needs one workshop with an active owner and at least one issued or cancelled invoice.
// It writes nothing: the calls under test must refuse, the raw SQL part runs in a rolled-back transaction.
const databaseUrl = process.env.RLS_TEST_DATABASE_URL;

vi.mock('server-only', () => ({}));

let session: SessionContext;
vi.mock('../lib/session', () => ({
  getSessionContext: vi.fn(async () => session),
  NoTenantError: class NoTenantError extends Error {},
}));

class Rollback extends Error {}

type Fixture = { tenantId: string; userId: string; invoiceId: string; status: string; lines: string; head: string };

describe.skipIf(!databaseUrl)('editing a non-draft invoice under row level security', () => {
  let admin: ReturnType<typeof postgres>;
  let fixture: Fixture;
  let previousDatabaseUrl: string | undefined;

  const snapshot = async (invoiceId: string) => {
    const [row] = await admin`
      select i.status,
             concat_ws('|', i.number, i.customer_id, i.due_date::text, i.issued_at::text) as head,
             (select string_agg(description || ':' || qty_milli || ':' || unit_price_cents, '|' order by position)
                from invoice_lines l where l.invoice_id = i.id) as lines
        from invoices i where i.id = ${invoiceId}`;
    return row;
  };

  beforeAll(async () => {
    admin = postgres(databaseUrl as string, { max: 1, onnotice: () => {} });
    const [row] = await admin`
      select i.tenant_id, m.user_id, i.id
        from invoices i
        join tenant_members m on m.tenant_id = i.tenant_id and m.role = 'owner' and m.deactivated_at is null
       where i.status in ('issued', 'cancelled')
       order by i.issued_at desc nulls last
       limit 1`;
    if (!row) throw new Error('The test database needs an issued invoice in a workshop with an owner.');
    const state = await snapshot(row.id as string);
    fixture = {
      tenantId: row.tenant_id as string,
      userId: row.user_id as string,
      invoiceId: row.id as string,
      status: state?.status as string,
      lines: state?.lines as string,
      head: state?.head as string,
    };
    session = { userId: fixture.userId, tenantId: fixture.tenantId, role: 'owner' };
    // lib/db/client reads DATABASE_URL when it is first imported
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
  });

  afterAll(async () => {
    process.env.DATABASE_URL = previousDatabaseUrl;
    await admin?.end();
  });

  it('documents the trap: SELECT ... FOR UPDATE does not see an issued invoice, a plain SELECT does', async () => {
    const found: Record<string, number> = {};
    try {
      await admin.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: fixture.userId })}, true)`;
        await tx.unsafe('SET LOCAL ROLE authenticated');
        found.plain = (await tx`select id from invoices where id = ${fixture.invoiceId}`).length;
        found.forUpdate = (await tx`select id from invoices where id = ${fixture.invoiceId} for update`).length;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(found.plain).toBe(1);
    expect(found.forUpdate).toBe(0);
  });

  it('refuses update and delete with "not editable" instead of reporting success, and changes nothing', async () => {
    const { updateInvoice, deleteInvoice, InvoiceNotEditableError } = await import('../lib/db/invoices');
    const [customer] = await admin`select customer_id from invoices where id = ${fixture.invoiceId}`;

    await expect(
      updateInvoice(fixture.tenantId, fixture.invoiceId, {
        customerId: customer?.customer_id as string,
        vehicleId: undefined,
        serviceDate: '2026-11-18',
        dueAt: '2026-12-02',
        taxMode: 'standard19',
        lines: [{ description: 'Manipuliert', quantity: 1, unitPrice: 1 }],
      }),
    ).rejects.toBeInstanceOf(InvoiceNotEditableError);
    await expect(deleteInvoice(fixture.tenantId, fixture.invoiceId)).rejects.toBeInstanceOf(InvoiceNotEditableError);

    const after = await snapshot(fixture.invoiceId);
    expect(after?.status).toBe(fixture.status);
    expect(after?.lines).toBe(fixture.lines);
    expect(after?.head).toBe(fixture.head);
    expect(fixture.lines).toBeTruthy();
  });

  it('answers "not found" for an invoice id that does not exist', async () => {
    const { updateInvoice, deleteInvoice, InvoiceNotFoundError } = await import('../lib/db/invoices');
    const [customer] = await admin`select customer_id from invoices where id = ${fixture.invoiceId}`;
    const unknown = randomUUID();

    await expect(
      updateInvoice(fixture.tenantId, unknown, {
        customerId: customer?.customer_id as string,
        vehicleId: undefined,
        serviceDate: '2026-11-18',
        dueAt: '2026-12-02',
        taxMode: 'standard19',
        lines: [{ description: 'X', quantity: 1, unitPrice: 1 }],
      }),
    ).rejects.toBeInstanceOf(InvoiceNotFoundError);
    await expect(deleteInvoice(fixture.tenantId, unknown)).rejects.toBeInstanceOf(InvoiceNotFoundError);
  });
});
