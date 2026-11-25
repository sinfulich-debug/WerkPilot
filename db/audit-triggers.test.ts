import { describe, expect, it } from 'vitest';
import postgres from 'postgres';

// Integration test against a TEST database (never the main one). Skipped unless RLS_TEST_DATABASE_URL is set.
// Everything runs inside one transaction that is rolled back, so no data stays behind.
// It needs one tenant with an owner (e.g. the one made by `npm run tenant:create`).
const databaseUrl = process.env.RLS_TEST_DATABASE_URL;

class Rollback extends Error {}

describe.skipIf(!databaseUrl)('audit log triggers (work_orders, stock_movements)', () => {
  it('logs inserts/updates with the acting user and keeps the log read-only', async () => {
    const sql = postgres(databaseUrl as string, { max: 1, onnotice: () => {} });
    const result: {
      actions: string[];
      actorsOk: boolean;
      blocked: Record<string, string | undefined>;
    } = { actions: [], actorsOk: false, blocked: {} };

    try {
      await sql.begin(async (tx) => {
        const [member] = await tx`select tenant_id, user_id from tenant_members where role = 'owner' limit 1`;
        if (!member) throw new Error('The test database needs a tenant with an owner.');

        const [customer] = await tx`insert into customers (tenant_id, name) values (${member.tenant_id}, 'AUDIT TEST') returning id`;
        const [vehicle] = await tx`insert into vehicles (tenant_id, customer_id, make, model, plate) values (${member.tenant_id}, ${customer.id}, 'T', 'T', 'AUD-1') returning id`;
        const [part] = await tx`insert into parts (tenant_id, sku, name, purchase_price_cents, sale_price_cents) values (${member.tenant_id}, 'AUD-SKU', 'AUDIT PART', 100, 200) returning id`;

        // Act as the logged-in user, the same way withUser does.
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: member.user_id })}, true)`;
        await tx.unsafe('SET LOCAL ROLE authenticated');

        const [order] = await tx`insert into work_orders (tenant_id, customer_id, vehicle_id, number, description) values (${member.tenant_id}, ${customer.id}, ${vehicle.id}, 'AUDIT-T-1', 'audit test') returning id`;
        await tx`update work_orders set status = 'estimate' where id = ${order.id}`;
        const [movement] = await tx`insert into stock_movements (tenant_id, part_id, qty_milli, reason) values (${member.tenant_id}, ${part.id}, 1000, 'purchase') returning id`;

        const rows = await tx`select action, user_id from audit_log where entity_id in (${order.id}, ${movement.id}) order by action`;
        result.actions = rows.map((row) => row.action as string);
        result.actorsOk = rows.every((row) => row.user_id === member.user_id);

        const attempts: Record<string, string> = {
          update: "update audit_log set action = 'x'",
          delete: 'delete from audit_log',
          insert: `insert into audit_log (tenant_id, action, entity, entity_id, data) values ('${member.tenant_id}', 'x', 'x', '${order.id}', '{}')`,
        };
        for (const [name, statement] of Object.entries(attempts)) {
          await tx.unsafe('SAVEPOINT attempt');
          try {
            await tx.unsafe(statement);
            result.blocked[name] = undefined;
          } catch (error) {
            result.blocked[name] = (error as { code?: string }).code;
          }
          await tx.unsafe('ROLLBACK TO SAVEPOINT attempt');
        }

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    } finally {
      await sql.end();
    }

    expect(result.actions).toEqual(['stock_movements.insert', 'work_orders.insert', 'work_orders.update']);
    expect(result.actorsOk).toBe(true);
    // 42501 = insufficient_privilege: users cannot write to the log at all.
    expect(result.blocked).toEqual({ update: '42501', delete: '42501', insert: '42501' });
  });
});
