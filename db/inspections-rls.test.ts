import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import postgres from 'postgres';

// Integration test against a TEST database (never the main one). Skipped unless RLS_TEST_DATABASE_URL is set.
// Needs migration 0022 and one workshop with an active owner. One transaction, rolled back at the end.
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

const newUser = async (tx: Tx, label: string) => {
  const id = randomUUID();
  await tx`insert into auth.users (id, email, aud, role) values (${id}, ${`${label}-${id}@rls-test.invalid`}, 'authenticated', 'authenticated')`;
  return id;
};

const PHOTO = `data:image/jpeg;base64,${'A'.repeat(1000)}`;

describe.skipIf(!databaseUrl)('vehicle inspections (DVI) row-level security', () => {
  it('lets every member fill in inspections, only owner/office delete them, and keeps other workshops out', async () => {
    const sql = postgres(databaseUrl as string, { max: 1, onnotice: () => {} });
    const found: Record<string, unknown> = {};

    try {
      await sql.begin(async (tx) => {
        const [owner] = await tx`select tenant_id, user_id from tenant_members where role = 'owner' and deactivated_at is null limit 1`;
        if (!owner) throw new Error('The test database needs a tenant with an owner.');
        const tenantId = owner.tenant_id as string;
        const mechanicId = await newUser(tx, 'mechanic');
        await tx`insert into tenant_members (tenant_id, user_id, role, display_name) values (${tenantId}, ${mechanicId}, 'mechanic', 'Test Mechaniker')`;
        const [otherTenant] = await tx`insert into tenants (name) values ('RLS TEST OTHER') returning id`;
        const otherOwnerId = await newUser(tx, 'other-owner');
        await tx`insert into tenant_members (tenant_id, user_id, role) values (${otherTenant.id}, ${otherOwnerId}, 'owner')`;

        // ---- the mechanic does an inspection with a photo ----
        const ids = await asUser(tx, mechanicId, async () => {
          const [inspection] = await tx`insert into vehicle_inspections (tenant_id, customer_name, vehicle_label, plate, created_by)
            values (${tenantId}, 'RLS Kunde', 'VW Golf', 'S-RL 1', ${mechanicId}) returning id`;
          const [item] = await tx`insert into vehicle_inspection_items (tenant_id, inspection_id, position, label, status, note)
            values (${tenantId}, ${inspection.id}, 0, 'Bremsanlage', 'gelb', 'Beläge vorn') returning id`;
          await tx`insert into vehicle_inspection_photos (tenant_id, item_id, data_url) values (${tenantId}, ${item.id}, ${PHOTO})`;
          const updated = await tx`update vehicle_inspection_items set status = 'rot' where id = ${item.id} returning id`;
          found.mechanicUpdate = updated.length;
          const deletedPhoto = await tx`delete from vehicle_inspection_photos where item_id = ${item.id} returning id`;
          found.mechanicDeletesPhoto = deletedPhoto.length;
          await tx`insert into vehicle_inspection_photos (tenant_id, item_id, data_url) values (${tenantId}, ${item.id}, ${PHOTO})`;
          // deleting the whole inspection is not the mechanic's call
          found.mechanicDeletesInspection = (await tx`delete from vehicle_inspections where id = ${inspection.id} returning id`).length;
          return { inspectionId: inspection.id as string, itemId: item.id as string };
        });

        // ---- checks in the database itself ----
        await asUser(tx, mechanicId, async () => {
          found.badStatus = await errorCodeOf(tx, () => tx`update vehicle_inspection_items set status = 'blau' where id = ${ids.itemId}`);
          found.blankLabel = await errorCodeOf(tx, () => tx`update vehicle_inspection_items set label = '   ' where id = ${ids.itemId}`);
          found.longNote = await errorCodeOf(tx, () => tx`update vehicle_inspection_items set note = ${'x'.repeat(2001)} where id = ${ids.itemId}`);
          found.secondPhoto = await errorCodeOf(tx, () => tx`insert into vehicle_inspection_photos (tenant_id, item_id, data_url) values (${tenantId}, ${ids.itemId}, ${PHOTO})`);
          found.pngPhoto = await errorCodeOf(tx, () => tx`update vehicle_inspection_photos set data_url = 'data:image/png;base64,AAAA' where item_id = ${ids.itemId}`);
          found.scriptPhoto = await errorCodeOf(tx, () => tx`update vehicle_inspection_photos set data_url = 'javascript:alert(1)' where item_id = ${ids.itemId}`);
          found.hugePhoto = await errorCodeOf(tx, () => tx`update vehicle_inspection_photos set data_url = ${`data:image/jpeg;base64,${'A'.repeat(800_001)}`} where item_id = ${ids.itemId}`);
        });

        // ---- another workshop sees and changes nothing ----
        await asUser(tx, otherOwnerId, async () => {
          found.foreignSees = Number((await tx`select count(*)::int as n from vehicle_inspections where id = ${ids.inspectionId}`)[0]?.n);
          found.foreignSeesPhotos = Number((await tx`select count(*)::int as n from vehicle_inspection_photos where item_id = ${ids.itemId}`)[0]?.n);
          found.foreignUpdate = (await tx`update vehicle_inspection_items set note = 'gehackt' where id = ${ids.itemId} returning id`).length;
          found.foreignInsertIntoOurs = await errorCodeOf(tx, () => tx`insert into vehicle_inspections (tenant_id, customer_name) values (${tenantId}, 'fremd')`);
          // an item of its own workshop pointing to OUR inspection fails on the (tenant_id, id) foreign key
          found.foreignItemOnOurInspection = await errorCodeOf(
            tx,
            () => tx`insert into vehicle_inspection_items (tenant_id, inspection_id, position, label) values (${otherTenant.id}, ${ids.inspectionId}, 0, 'x')`,
          );
        });

        // ---- anon gets nothing ----
        await tx.unsafe('SAVEPOINT anon_try');
        try {
          await tx.unsafe('SET LOCAL ROLE anon');
          await tx`select count(*) from vehicle_inspections`;
          found.anon = 'allowed';
        } catch (error) {
          found.anon = (error as { code?: string }).code;
        } finally {
          await tx.unsafe('ROLLBACK TO SAVEPOINT anon_try');
        }

        // ---- the owner deletes the inspection: items and photo go with it ----
        await asUser(tx, owner.user_id as string, async () => {
          found.ownerDeletes = (await tx`delete from vehicle_inspections where id = ${ids.inspectionId} returning id`).length;
        });
        found.itemsLeft = Number((await tx`select count(*)::int as n from vehicle_inspection_items where id = ${ids.itemId}`)[0]?.n);
        found.photosLeft = Number((await tx`select count(*)::int as n from vehicle_inspection_photos where item_id = ${ids.itemId}`)[0]?.n);

        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    } finally {
      await sql.end();
    }

    expect(found.mechanicUpdate).toBe(1);
    expect(found.mechanicDeletesPhoto).toBe(1);
    expect(found.mechanicDeletesInspection).toBe(0);

    expect(found.badStatus).toBe('23514');
    expect(found.blankLabel).toBe('23514');
    expect(found.longNote).toBe('23514');
    expect(found.secondPhoto).toBe('23505'); // one photo per item
    expect(found.pngPhoto).toBe('23514');
    expect(found.scriptPhoto).toBe('23514');
    expect(found.hugePhoto).toBe('23514');

    expect(found.foreignSees).toBe(0);
    expect(found.foreignSeesPhotos).toBe(0);
    expect(found.foreignUpdate).toBe(0);
    expect(found.foreignInsertIntoOurs).toBe('42501');
    expect(found.foreignItemOnOurInspection).toBe('23503');
    expect(found.anon).toBe('42501');

    expect(found.ownerDeletes).toBe(1);
    expect(found.itemsLeft).toBe(0);
    expect(found.photosLeft).toBe(0);
  });
});
