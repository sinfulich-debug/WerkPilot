import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { withUser } from './with-user';
import * as schema from './schema';
import {
  customers,
  invoiceLines,
  invoices,
  tenantMembers,
  tenantProfiles,
  tenants,
} from './schema';

const databaseUrl = process.env.RLS_TEST_DATABASE_URL;
const userAId = process.env.RLS_TEST_USER_A;
const userBId = process.env.RLS_TEST_USER_B;
const testEnabled = Boolean(databaseUrl && userAId && userBId);

describe.skipIf(!testEnabled)('tenant RLS integration', () => {
  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const customerAId = randomUUID();
  const customerBId = randomUUID();
  const invoiceDraftId = randomUUID();
  const invoiceIssuedId = randomUUID();
  const invoiceLineIssuedId = randomUUID();
  let adminClient: ReturnType<typeof postgres>;
  let adminDb: ReturnType<typeof drizzle<typeof schema>>;
  let previousDatabaseUrl: string | undefined;

  beforeAll(async () => {
    if (!databaseUrl || !userAId || !userBId) {
      throw new Error('Set RLS_TEST_DATABASE_URL, RLS_TEST_USER_A and RLS_TEST_USER_B.');
    }
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(userAId) || !uuidPattern.test(userBId)) {
      throw new Error('RLS_TEST_USER_A and RLS_TEST_USER_B must be UUIDs.');
    }

    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    adminClient = postgres(databaseUrl, { max: 1 });
    adminDb = drizzle(adminClient, { schema });

    const users = await adminClient`
      SELECT id
      FROM auth.users
      WHERE id = ${userAId}::uuid OR id = ${userBId}::uuid
    `;
    if (users.length !== 2) {
      throw new Error('Both RLS test users must already exist in auth.users.');
    }

    await adminDb.insert(tenants).values([
      { id: tenantAId, name: 'RLS test tenant A' },
      { id: tenantBId, name: 'RLS test tenant B' },
    ]);
    await adminDb.insert(tenantMembers).values([
      { tenantId: tenantAId, userId: userAId, role: 'mechanic' },
      { tenantId: tenantBId, userId: userBId, role: 'owner' },
    ]);
    await adminDb.insert(customers).values([
      { id: customerAId, tenantId: tenantAId, name: 'RLS test customer A' },
      { id: customerBId, tenantId: tenantBId, name: 'RLS test customer B' },
    ]);
    await adminDb.insert(tenantProfiles).values([
      { tenantId: tenantAId, companyName: 'RLS test profile A', iban: 'DE00000000000000000000' },
      { tenantId: tenantBId, companyName: 'RLS test profile B', iban: 'DE00000000000000000000' },
    ]);
    await adminDb.insert(invoices).values([
      {
        id: invoiceDraftId,
        tenantId: tenantBId,
        customerId: customerBId,
        status: 'draft',
        sellerSnapshot: { name: 'RLS test seller' },
        buyerSnapshot: { name: 'RLS test buyer' },
      },
      {
        id: invoiceIssuedId,
        tenantId: tenantBId,
        customerId: customerBId,
        status: 'draft',
        sellerSnapshot: { name: 'RLS test seller' },
        buyerSnapshot: { name: 'RLS test buyer' },
      },
    ]);
    await adminDb.insert(invoiceLines).values({
      id: invoiceLineIssuedId,
      tenantId: tenantBId,
      invoiceId: invoiceIssuedId,
      position: 1,
      description: 'RLS test line',
      qtyMilli: 1_000,
      unitPriceCents: 1_000,
      taxRateBp: 1_900,
    });
    await adminDb
      .update(invoices)
      .set({ status: 'issued', number: 'RLS-TEST-ISSUED', issuedAt: new Date() })
      .where(eq(invoices.id, invoiceIssuedId));
  });

  afterAll(async () => {
    try {
      if (adminDb) {
        await adminClient`ALTER TABLE public.invoices DISABLE TRIGGER invoices_immutable`;
        await adminClient`ALTER TABLE public.invoice_lines DISABLE TRIGGER invoice_lines_immutable`;
        try {
          await adminDb.delete(invoiceLines).where(inArray(invoiceLines.invoiceId, [invoiceDraftId, invoiceIssuedId]));
          await adminDb.delete(invoices).where(inArray(invoices.id, [invoiceDraftId, invoiceIssuedId]));
        } finally {
          await adminClient`ALTER TABLE public.invoice_lines ENABLE TRIGGER invoice_lines_immutable`;
          await adminClient`ALTER TABLE public.invoices ENABLE TRIGGER invoices_immutable`;
        }
        await adminDb.delete(tenantProfiles).where(inArray(tenantProfiles.tenantId, [tenantAId, tenantBId]));
        await adminDb.delete(customers).where(inArray(customers.id, [customerAId, customerBId]));
        await adminDb.delete(tenantMembers).where(
          and(
            inArray(tenantMembers.tenantId, [tenantAId, tenantBId]),
            inArray(tenantMembers.userId, [userAId ?? '', userBId ?? '']),
          ),
        );
        await adminDb.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]));
      }
    } finally {
      if (adminClient) {
        await adminClient.end();
      }
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  it('isolates tenants, applies role restrictions and keeps issued invoices immutable', async () => {
    const visibleCustomers = await withUser(userAId!, tenantAId, (tx) =>
      tx.select({ id: customers.id }).from(customers),
    );
    expect(visibleCustomers).toEqual([{ id: customerAId }]);

    await expect(
      withUser(userAId!, tenantAId, (tx) =>
        tx.insert(customers).values({
          tenantId: tenantBId,
          name: 'Cross-tenant insert',
        }),
      ),
    ).rejects.toThrow();

    const updatedForeignRows = await withUser(userAId!, tenantAId, (tx) =>
      tx
        .update(customers)
        .set({ name: 'Unauthorized update' })
        .where(eq(customers.id, customerBId))
        .returning({ id: customers.id }),
    );
    const deletedForeignRows = await withUser(userAId!, tenantAId, (tx) =>
      tx.delete(customers).where(eq(customers.id, customerBId)).returning({ id: customers.id }),
    );
    expect(updatedForeignRows).toHaveLength(0);
    expect(deletedForeignRows).toHaveLength(0);

    const mechanicInvoices = await withUser(userAId!, tenantAId, (tx) =>
      tx.select({ id: invoices.id }).from(invoices),
    );
    const mechanicProfiles = await withUser(userAId!, tenantAId, (tx) =>
      tx.select({ id: tenantProfiles.id }).from(tenantProfiles),
    );
    expect(mechanicInvoices).toEqual([]);
    expect(mechanicProfiles).toEqual([]);

    const draftUpdated = await withUser(userBId!, tenantBId, (tx) =>
      tx
        .update(invoices)
        .set({ buyerSnapshot: { name: 'Updated draft buyer' } })
        .where(eq(invoices.id, invoiceDraftId))
        .returning({ id: invoices.id }),
    );
    const issuedUpdated = await withUser(userBId!, tenantBId, (tx) =>
      tx
        .update(invoices)
        .set({ buyerSnapshot: { name: 'Must not update issued invoice' } })
        .where(eq(invoices.id, invoiceIssuedId))
        .returning({ id: invoices.id }),
    );
    expect(draftUpdated).toHaveLength(1);
    expect(issuedUpdated).toHaveLength(0);

    await expect(
      adminDb
        .update(invoices)
        .set({ buyerSnapshot: { name: 'Must not update issued invoice' } })
        .where(eq(invoices.id, invoiceIssuedId)),
    ).rejects.toThrow('Issued invoices cannot be modified.');
    await expect(
      adminDb.delete(invoiceLines).where(eq(invoiceLines.id, invoiceLineIssuedId)),
    ).rejects.toThrow('Invoice lines can only be changed while the invoice is a draft.');

    const visibleToPostgres = await adminDb
      .select({ id: customers.id })
      .from(customers)
      .where(inArray(customers.id, [customerAId, customerBId]));
    expect(visibleToPostgres).toHaveLength(2);
  });
});
