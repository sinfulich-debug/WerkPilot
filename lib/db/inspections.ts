import 'server-only';

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { vehicleInspectionItems, vehicleInspectionPhotos, vehicleInspections } from '../../db/schema';
import { assertTenantContext, withTenant } from '../../db/with-tenant';
import type { UserTransaction } from '../../db/with-user';
import {
  DEFAULT_CHECKLIST,
  type ImportedInspection,
  type Inspection,
  type InspectionHeader,
  type InspectionStatus,
  type ItemChange,
} from '../inspections';

export class InspectionNotFoundError extends Error {
  constructor(message = 'Die Fahrzeugprüfung wurde nicht gefunden.') {
    super(message);
    this.name = 'InspectionNotFoundError';
  }
}

const MAX_LIST = 200;

async function loadInspections(tx: UserTransaction, tenantId: string, ids?: string[]): Promise<Inspection[]> {
  const headers = await tx
    .select()
    .from(vehicleInspections)
    .where(ids ? and(eq(vehicleInspections.tenantId, tenantId), inArray(vehicleInspections.id, ids)) : eq(vehicleInspections.tenantId, tenantId))
    .orderBy(desc(vehicleInspections.createdAt), desc(vehicleInspections.id))
    .limit(MAX_LIST);
  if (headers.length === 0) return [];

  const inspectionIds = headers.map((header) => header.id);
  // photo data is not loaded here, only whether there is one (lists stay small)
  const items = await tx
    .select({
      id: vehicleInspectionItems.id,
      inspectionId: vehicleInspectionItems.inspectionId,
      label: vehicleInspectionItems.label,
      status: vehicleInspectionItems.status,
      note: vehicleInspectionItems.note,
      hasPhoto: sql<boolean>`(${vehicleInspectionPhotos.id} is not null)`,
    })
    .from(vehicleInspectionItems)
    .leftJoin(
      vehicleInspectionPhotos,
      and(eq(vehicleInspectionPhotos.tenantId, tenantId), eq(vehicleInspectionPhotos.itemId, vehicleInspectionItems.id)),
    )
    .where(and(eq(vehicleInspectionItems.tenantId, tenantId), inArray(vehicleInspectionItems.inspectionId, inspectionIds)))
    .orderBy(asc(vehicleInspectionItems.position), asc(vehicleInspectionItems.createdAt));

  return headers.map((header) => ({
    id: header.id,
    customerName: header.customerName,
    vehicleLabel: header.vehicleLabel,
    plate: header.plate,
    createdAt: header.createdAt.toISOString(),
    items: items
      .filter((item) => item.inspectionId === header.id)
      .map((item) => ({
        id: item.id,
        label: item.label,
        status: item.status as InspectionStatus,
        note: item.note,
        hasPhoto: Boolean(item.hasPhoto),
      })),
  }));
}

async function touch(tx: UserTransaction, tenantId: string, inspectionId: string): Promise<void> {
  await tx
    .update(vehicleInspections)
    .set({ updatedAt: new Date() })
    .where(and(eq(vehicleInspections.tenantId, tenantId), eq(vehicleInspections.id, inspectionId)));
}

/** Finds the inspection an item belongs to (within the workshop) or throws. */
async function inspectionOfItem(tx: UserTransaction, tenantId: string, itemId: string): Promise<string> {
  const [item] = await tx
    .select({ inspectionId: vehicleInspectionItems.inspectionId })
    .from(vehicleInspectionItems)
    .where(and(eq(vehicleInspectionItems.tenantId, tenantId), eq(vehicleInspectionItems.id, itemId)));
  if (!item) throw new InspectionNotFoundError('Der Prüfpunkt wurde nicht gefunden.');
  return item.inspectionId;
}

export async function listInspections(tenantId: string): Promise<Inspection[]> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    return loadInspections(tx, tenantId);
  });
}

/** New inspection with the default checklist, created by the signed-in user. */
export async function createInspection(tenantId: string, header: InspectionHeader): Promise<Inspection> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const [created] = await tx
      .insert(vehicleInspections)
      .values({ tenantId, ...header, createdBy: context.userId })
      .returning({ id: vehicleInspections.id });
    if (!created) throw new Error('Die Fahrzeugprüfung konnte nicht angelegt werden.');
    await tx.insert(vehicleInspectionItems).values(
      DEFAULT_CHECKLIST.map((label, position) => ({ tenantId, inspectionId: created.id, position, label })),
    );
    const [inspection] = await loadInspections(tx, tenantId, [created.id]);
    if (!inspection) throw new Error('Die Fahrzeugprüfung konnte nicht geladen werden.');
    return inspection;
  });
}

export async function updateInspectionHeader(tenantId: string, id: string, header: InspectionHeader): Promise<void> {
  await withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .update(vehicleInspections)
      .set({ ...header, updatedAt: new Date() })
      .where(and(eq(vehicleInspections.tenantId, tenantId), eq(vehicleInspections.id, id)))
      .returning({ id: vehicleInspections.id });
    if (rows.length === 0) throw new InspectionNotFoundError();
  });
}

export async function updateInspectionItem(tenantId: string, itemId: string, change: ItemChange): Promise<void> {
  await withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const inspectionId = await inspectionOfItem(tx, tenantId, itemId);
    await tx
      .update(vehicleInspectionItems)
      .set(change)
      .where(and(eq(vehicleInspectionItems.tenantId, tenantId), eq(vehicleInspectionItems.id, itemId)));
    await touch(tx, tenantId, inspectionId);
  });
}

/** Sets or replaces the photo of an item (one photo per item). */
export async function setInspectionPhoto(tenantId: string, itemId: string, dataUrl: string): Promise<void> {
  await withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const inspectionId = await inspectionOfItem(tx, tenantId, itemId);
    await tx
      .insert(vehicleInspectionPhotos)
      .values({ tenantId, itemId, dataUrl })
      .onConflictDoUpdate({ target: vehicleInspectionPhotos.itemId, set: { dataUrl, createdAt: new Date() } });
    await touch(tx, tenantId, inspectionId);
  });
}

export async function getInspectionPhoto(tenantId: string, itemId: string): Promise<string | null> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const [photo] = await tx
      .select({ dataUrl: vehicleInspectionPhotos.dataUrl })
      .from(vehicleInspectionPhotos)
      .where(and(eq(vehicleInspectionPhotos.tenantId, tenantId), eq(vehicleInspectionPhotos.itemId, itemId)));
    return photo?.dataUrl ?? null;
  });
}

export async function deleteInspectionPhoto(tenantId: string, itemId: string): Promise<void> {
  await withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const inspectionId = await inspectionOfItem(tx, tenantId, itemId);
    await tx
      .delete(vehicleInspectionPhotos)
      .where(and(eq(vehicleInspectionPhotos.tenantId, tenantId), eq(vehicleInspectionPhotos.itemId, itemId)));
    await touch(tx, tenantId, inspectionId);
  });
}

/** Deletes an inspection with its items and photos. Row-level security allows this only to owner and office. */
export async function deleteInspection(tenantId: string, id: string): Promise<void> {
  await withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .delete(vehicleInspections)
      .where(and(eq(vehicleInspections.tenantId, tenantId), eq(vehicleInspections.id, id)))
      .returning({ id: vehicleInspections.id });
    if (rows.length === 0) throw new InspectionNotFoundError();
  });
}

/** Moves inspections that were kept in the browser into the database, all or nothing. */
export async function importInspections(tenantId: string, inspections: ImportedInspection[]): Promise<number> {
  if (inspections.length === 0) return 0;
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    for (const entry of inspections) {
      const [created] = await tx
        .insert(vehicleInspections)
        .values({
          tenantId,
          customerName: entry.customerName,
          vehicleLabel: entry.vehicleLabel,
          plate: entry.plate,
          createdBy: context.userId,
        })
        .returning({ id: vehicleInspections.id });
      if (!created) throw new Error('Die Fahrzeugprüfung konnte nicht übernommen werden.');
      const items = await tx
        .insert(vehicleInspectionItems)
        .values(entry.items.map((item, position) => ({
          tenantId,
          inspectionId: created.id,
          position,
          label: item.label,
          status: item.status,
          note: item.note,
        })))
        .returning({ id: vehicleInspectionItems.id, position: vehicleInspectionItems.position });
      const photos = items.flatMap((item) => {
        const photo = entry.items[item.position]?.photo;
        return photo ? [{ tenantId, itemId: item.id, dataUrl: photo }] : [];
      });
      if (photos.length > 0) await tx.insert(vehicleInspectionPhotos).values(photos);
    }
    return inspections.length;
  });
}
