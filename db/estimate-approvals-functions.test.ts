import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import * as schema from './schema';
import type { UserTransaction } from './with-user';
import { hashApprovalToken } from '../lib/estimate-approval-token';
import type { SessionContext } from '../lib/session';

// Integration test of lib/db/estimate-approvals against a TEST database (never the main one).
// Skipped unless RLS_TEST_DATABASE_URL is set. Needs migration 0024. Everything runs inside one
// transaction that is rolled back, so nothing is left behind (work orders cannot be deleted later).
const databaseUrl = process.env.RLS_TEST_DATABASE_URL;

vi.mock('server-only', () => ({}));

class Rollback extends Error {}

describe.skipIf(!databaseUrl)('lib/db/estimate-approvals against the database', () => {
  it('creates links for estimates only and records the customer answer with all the rules', async () => {
    process.env.DATABASE_URL = databaseUrl; // lib/db modules read it lazily
    const approvals = await import('../lib/db/estimate-approvals');
    const client = postgres(databaseUrl as string, { max: 1, onnotice: () => {} });
    const database = drizzle(client, { schema });
    const f: Record<string, unknown> = {};

    try {
      await database.transaction(async (tx) => {
        const run = async (statement: ReturnType<typeof sql>) => (await tx.execute(statement)) as unknown as Array<Record<string, unknown>>;
        const asUser = async <T>(userId: string, fn: () => Promise<T>): Promise<T> => {
          await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`);
          await tx.execute(sql.raw('SET LOCAL ROLE authenticated'));
          try {
            return await fn();
          } finally {
            await tx.execute(sql.raw('RESET ROLE'));
          }
        };

        // ---- a workshop with a mechanic, a customer, a vehicle, a part without stock ----
        const [tenant] = await run(sql`insert into tenants (name) values ('IT APPROVALS') returning id`);
        const tenantId = tenant.id as string;
        const mechanicId = randomUUID();
        await run(sql`insert into auth.users (id, email, aud, role) values (${mechanicId}, ${`m-${mechanicId}@it.invalid`}, 'authenticated', 'authenticated')`);
        await run(sql`insert into tenant_members (tenant_id, user_id, role) values (${tenantId}, ${mechanicId}, 'mechanic')`);
        await run(sql`insert into tenant_profiles (tenant_id, company_name) values (${tenantId}, 'IT Werkstatt GmbH')`);
        const [customer] = await run(sql`insert into customers (tenant_id, name) values (${tenantId}, 'IT Kunde') returning id`);
        const [vehicle] = await run(sql`insert into vehicles (tenant_id, customer_id, plate, make, model) values (${tenantId}, ${customer.id}, 'S-IT 7', 'VW', 'Golf') returning id`);
        const [part] = await run(sql`insert into parts (tenant_id, sku, name, purchase_price_cents, sale_price_cents) values (${tenantId}, 'IT-1', 'Bremsscheibe', 5000, 9000) returning id`);

        let orderNumber = 0;
        const newOrder = async (status: string, withPart = false) => {
          orderNumber += 1;
          const [order] = await run(sql`insert into work_orders (tenant_id, customer_id, vehicle_id, number, status, description)
            values (${tenantId}, ${customer.id}, ${vehicle.id}, ${`IT-${orderNumber}`}, ${status}, 'Bremsen erneuern') returning id`);
          // 1 hour of labour, 100,00 EUR net, 19 % tax -> 119,00 EUR gross (11900 cents), secret purchase price on the part line
          await run(sql`insert into work_order_lines (tenant_id, work_order_id, position, description, kind, qty_milli, unit_price_cents, tax_rate_bp)
            values (${tenantId}, ${order.id}, 0, 'Arbeitszeit', 'labor', 1000, 10000, 1900)`);
          if (withPart) {
            await run(sql`insert into work_order_lines (tenant_id, work_order_id, position, description, kind, qty_milli, unit_price_cents, tax_rate_bp, part_id, purchase_price_cents)
              values (${tenantId}, ${order.id}, 1, 'Bremsscheibe', 'part', 1000, 9000, 1900, ${part.id}, 5000)`);
          }
          return order.id as string;
        };
        const status = async (orderId: string) => (await run(sql`select status::text as s from work_orders where id = ${orderId}`))[0].s;
        const context: SessionContext = { userId: mechanicId, tenantId, role: 'mechanic' };
        const database_tx = tx as unknown as UserTransaction;
        const makeLink = (orderId: string, now?: Date) => asUser(mechanicId, () => approvals.createApprovalLinkInTx(database_tx, context, tenantId, orderId, now));
        const toLink = (created: { id: string; expiresAt: Date }, orderId: string, totalGrossCents: number): import('../lib/db/estimate-approvals').ApprovalLink => ({
          id: created.id, tenantId, workOrderId: orderId, createdBy: mechanicId, expiresAt: created.expiresAt, decision: null, revokedAt: null, totalGrossCents,
        });
        const answer = (link: ReturnType<typeof toLink>, input: { decision: 'approved' | 'declined'; signerName: string; note: string }) =>
          asUser(mechanicId, () => approvals.answerApprovalInTx(database_tx, link, input));
        const SIGNED = { decision: 'approved' as const, signerName: 'Max Mustermann', note: '' };

        // ---- links exist only for estimates ----
        const draftId = await newOrder('draft');
        f.draftRefused = await makeLink(draftId).then(() => 'created', (error: Error) => error.name);
        f.unknownOrder = await makeLink(randomUUID()).then(() => 'created', (error: Error) => error.name);

        // ---- an estimate with labour only: link, page, approval ----
        const orderA = await newOrder('estimate');
        const created = await makeLink(orderA);
        f.tokenLength = created.token.length;
        const [stored] = await run(sql`select token_hash, total_gross_cents, created_by from estimate_approvals where id = ${created.id}`);
        f.storedHashMatches = stored.token_hash === hashApprovalToken(created.token);
        f.storedTokenNotPlain = !JSON.stringify(stored).includes(created.token);
        f.storedTotal = stored.total_gross_cents;
        f.storedCreator = stored.created_by === mechanicId;
        const linkA = toLink(created, orderA, 11_900);

        const page = await asUser(mechanicId, () => approvals.loadApprovalPageInTx(database_tx, linkA));
        f.pageVerdict = page?.verdict;
        f.pageWorkshop = page?.view.workshopName;
        f.pageGross = page?.view.grossCents;
        f.pageHidesPurchase = !JSON.stringify(page).toLowerCase().includes('purchase');

        const approved = await answer(linkA, SIGNED);
        f.approved = approved;
        f.orderAfterApproval = await status(orderA);
        const [row] = await run(sql`select decision, signer_name, decided_at is not null as has_time from estimate_approvals where id = ${created.id}`);
        f.rowAfterApproval = row;
        f.secondAnswer = await answer(linkA, { decision: 'declined', signerName: '', note: 'doch nicht' });

        // ---- the customer agrees but a part is not in stock: answer stays, order waits ----
        const orderB = await newOrder('estimate', true);
        const linkB = toLink(await makeLink(orderB), orderB, 11_900 + 10_710);
        f.stockShort = await answer(linkB, SIGNED);
        f.orderAfterShortage = await status(orderB);
        f.decisionAfterShortage = (await run(sql`select decision from estimate_approvals where id = ${linkB.id}`))[0].decision;

        // ---- declining ----
        const orderC = await newOrder('estimate');
        const linkC = toLink(await makeLink(orderC), orderC, 11_900);
        f.declined = await answer(linkC, { decision: 'declined', signerName: '', note: 'Zu teuer' });
        f.orderAfterDecline = await status(orderC);
        f.noteAfterDecline = (await run(sql`select decision_note from estimate_approvals where id = ${linkC.id}`))[0].decision_note;

        // ---- the amount changed after the link was made ----
        const orderD = await newOrder('estimate');
        const linkD = toLink(await makeLink(orderD), orderD, 11_900);
        await run(sql`update work_order_lines set unit_price_cents = 20000 where work_order_id = ${orderD}`);
        f.changed = await answer(linkD, SIGNED);

        // ---- expired and revoked links ----
        const orderE = await newOrder('estimate');
        const linkE = toLink(await makeLink(orderE, new Date(Date.now() - 20 * 24 * 3600 * 1000)), orderE, 11_900);
        f.expired = await answer(linkE, SIGNED);
        const orderF = await newOrder('estimate');
        const linkF = toLink(await makeLink(orderF), orderF, 11_900);
        await asUser(mechanicId, () => approvals.revokeApprovalLinkInTx(database_tx, tenantId, linkF.id).then((value) => { f.revokeWorked = value; }));
        f.revoked = await answer(linkF, SIGNED);
        await asUser(mechanicId, () => approvals.revokeApprovalLinkInTx(database_tx, tenantId, linkA.id).then((value) => { f.revokeDecidedLink = value; }));

        // ---- the list for the staff ----
        const listed = await asUser(mechanicId, () => approvals.listApprovalsInTx(database_tx, tenantId));
        f.listedCount = listed.length;
        f.listHasNoToken = !JSON.stringify(listed).includes(created.token) && !JSON.stringify(listed).includes('token');

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    } finally {
      await client.end();
    }

    expect(f.draftRefused).toBe('ApprovalNotAllowedError');
    expect(f.unknownOrder).toBe('ApprovalOrderNotFoundError');
    expect(f.tokenLength).toBe(43);
    expect(f.storedHashMatches).toBe(true);
    expect(f.storedTokenNotPlain).toBe(true);
    expect(f.storedTotal).toBe(11_900);
    expect(f.storedCreator).toBe(true);
    expect(f.pageVerdict).toBe('open');
    expect(f.pageWorkshop).toBe('IT Werkstatt GmbH');
    expect(f.pageGross).toBe(11_900);
    expect(f.pageHidesPurchase).toBe(true);

    expect(f.approved).toEqual({ kind: 'recorded', decision: 'approved', orderApproved: true });
    expect(f.orderAfterApproval).toBe('approved');
    expect(f.rowAfterApproval).toMatchObject({ decision: 'approved', signer_name: 'Max Mustermann', has_time: true });
    expect(f.secondAnswer).toEqual({ kind: 'refused', verdict: 'already_decided', decision: 'approved' });

    expect(f.stockShort).toEqual({ kind: 'recorded', decision: 'approved', orderApproved: false });
    expect(f.orderAfterShortage).toBe('estimate');
    expect(f.decisionAfterShortage).toBe('approved');

    expect(f.declined).toEqual({ kind: 'recorded', decision: 'declined', orderApproved: false });
    expect(f.orderAfterDecline).toBe('estimate');
    expect(f.noteAfterDecline).toBe('Zu teuer');

    expect(f.changed).toEqual({ kind: 'refused', verdict: 'changed', decision: null });
    expect(f.expired).toEqual({ kind: 'refused', verdict: 'expired', decision: null });
    expect(f.revokeWorked).toBe(true);
    expect(f.revoked).toEqual({ kind: 'refused', verdict: 'revoked', decision: null });
    expect(f.revokeDecidedLink).toBe(false);

    expect(f.listedCount).toBe(6);
    expect(f.listHasNoToken).toBe(true);
  });
});
