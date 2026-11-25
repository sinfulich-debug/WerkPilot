import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import type { SessionContext } from '../lib/session';

// Integration test of lib/db/inspections against a TEST database (never the main one).
// Skipped unless RLS_TEST_DATABASE_URL is set. Needs migration 0022 and a workshop with an active owner.
// The real functions commit, so every inspection created here is deleted again in afterAll
// (inspections are not part of the audit log, nothing is left behind).
const databaseUrl = process.env.RLS_TEST_DATABASE_URL;

vi.mock('server-only', () => ({}));

let session: SessionContext;
vi.mock('../lib/session', () => ({
  getSessionContext: vi.fn(async () => session),
  NoTenantError: class NoTenantError extends Error {},
}));

const photo = (fill: string) => `data:image/jpeg;base64,${fill.repeat(400)}`;

describe.skipIf(!databaseUrl)('lib/db/inspections against the database', () => {
  let admin: ReturnType<typeof postgres>;
  let previousDatabaseUrl: string | undefined;
  const created: string[] = [];

  beforeAll(async () => {
    admin = postgres(databaseUrl as string, { max: 1, onnotice: () => {} });
    const [owner] = await admin`select tenant_id, user_id from tenant_members where role = 'owner' and deactivated_at is null limit 1`;
    if (!owner) throw new Error('The test database needs a workshop with an owner.');
    session = { userId: owner.user_id as string, tenantId: owner.tenant_id as string, role: 'owner' };
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl; // lib/db/client reads it on first import
  });

  afterAll(async () => {
    if (created.length > 0) await admin`delete from vehicle_inspections where id in ${admin(created)}`;
    process.env.DATABASE_URL = previousDatabaseUrl;
    await admin?.end();
  });

  it('creates, fills in, photographs and deletes an inspection', async () => {
    const db = await import('../lib/db/inspections');
    const { tenantId } = session;

    const inspection = await db.createInspection(tenantId, { customerName: 'IT Kunde', vehicleLabel: 'VW Golf', plate: 'S-IT 1' });
    created.push(inspection.id);
    expect(inspection.items.map((item) => item.label)).toEqual(['Bremsanlage', 'Bereifung', 'Beleuchtung']);
    expect(inspection.items.every((item) => item.status === 'gruen' && !item.hasPhoto)).toBe(true);

    const brakes = inspection.items[0]!;
    await db.updateInspectionHeader(tenantId, inspection.id, { customerName: 'IT Kunde 2', vehicleLabel: 'VW Golf', plate: 'S-IT 2' });
    await db.updateInspectionItem(tenantId, brakes.id, { status: 'rot', note: 'Beläge verschlissen' });
    await db.setInspectionPhoto(tenantId, brakes.id, photo('A'));
    await db.setInspectionPhoto(tenantId, brakes.id, photo('B')); // replaces, one photo per item

    const listed = (await db.listInspections(tenantId)).find((entry) => entry.id === inspection.id);
    expect(listed).toMatchObject({ customerName: 'IT Kunde 2', plate: 'S-IT 2' });
    expect(listed?.items[0]).toMatchObject({ status: 'rot', note: 'Beläge verschlissen', hasPhoto: true });
    expect(listed?.items[1]?.hasPhoto).toBe(false);
    expect(JSON.stringify(listed)).not.toContain('base64'); // the list never carries photo data
    expect(await db.getInspectionPhoto(tenantId, brakes.id)).toBe(photo('B'));
    expect(Number((await admin`select count(*)::int as n from vehicle_inspection_photos where item_id = ${brakes.id}`)[0]?.n)).toBe(1);

    const [{ updated_at: touched }] = await admin`select updated_at from vehicle_inspections where id = ${inspection.id}`;
    expect(new Date(touched as string).getTime()).toBeGreaterThan(new Date(inspection.createdAt).getTime());

    await db.deleteInspectionPhoto(tenantId, brakes.id);
    expect(await db.getInspectionPhoto(tenantId, brakes.id)).toBeNull();

    await db.deleteInspection(tenantId, inspection.id);
    expect((await db.listInspections(tenantId)).some((entry) => entry.id === inspection.id)).toBe(false);
    expect(Number((await admin`select count(*)::int as n from vehicle_inspection_items where inspection_id = ${inspection.id}`)[0]?.n)).toBe(0);
  });

  it('answers "not found" for unknown ids instead of pretending to succeed', async () => {
    const db = await import('../lib/db/inspections');
    const unknown = randomUUID();
    await expect(db.updateInspectionHeader(session.tenantId, unknown, { customerName: '', vehicleLabel: '', plate: '' })).rejects.toBeInstanceOf(db.InspectionNotFoundError);
    await expect(db.updateInspectionItem(session.tenantId, unknown, { note: 'x' })).rejects.toBeInstanceOf(db.InspectionNotFoundError);
    await expect(db.setInspectionPhoto(session.tenantId, unknown, photo('A'))).rejects.toBeInstanceOf(db.InspectionNotFoundError);
    await expect(db.deleteInspection(session.tenantId, unknown)).rejects.toBeInstanceOf(db.InspectionNotFoundError);
  });

  it('imports old browser inspections with their photos, all or nothing', async () => {
    const db = await import('../lib/db/inspections');
    const before = new Set((await db.listInspections(session.tenantId)).map((entry) => entry.id));

    const count = await db.importInspections(session.tenantId, [
      {
        customerName: 'IT Import',
        vehicleLabel: 'Audi A4',
        plate: 'S-IM 1',
        items: [
          { label: 'Bremsanlage', status: 'gelb', note: 'beobachten', photo: photo('C') },
          { label: 'Bereifung', status: 'gruen', note: '', photo: null },
        ],
      },
    ]);
    expect(count).toBe(1);
    const imported = (await db.listInspections(session.tenantId)).filter((entry) => !before.has(entry.id));
    created.push(...imported.map((entry) => entry.id));
    expect(imported).toHaveLength(1);
    expect(imported[0]?.items.map((item) => [item.label, item.status, item.hasPhoto])).toEqual([
      ['Bremsanlage', 'gelb', true],
      ['Bereifung', 'gruen', false],
    ]);

    // a photo the database refuses makes the whole batch fail - nothing half-imported stays behind
    const countBefore = (await db.listInspections(session.tenantId)).length;
    await expect(
      db.importInspections(session.tenantId, [
        { customerName: 'IT ok', vehicleLabel: '', plate: '', items: [{ label: 'A', status: 'gruen', note: '', photo: null }] },
        { customerName: 'IT kaputt', vehicleLabel: '', plate: '', items: [{ label: 'B', status: 'gruen', note: '', photo: 'data:image/png;base64,QUJD' }] },
      ]),
    ).rejects.toThrow();
    expect((await db.listInspections(session.tenantId)).length).toBe(countBefore);
  });
});
