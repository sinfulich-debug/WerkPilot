import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { customers, parts, stockMovements, vehicles, workOrderLines, workOrders } from '../../db/schema';
import { assertTenantContext, withTenant } from '../../db/with-tenant';
import type { UserTransaction } from '../../db/with-user';
import { assertStockAvailable } from '../stock';
import { euroToCents, quantityToMilli } from '../finance';
import type { WorkOrder, WorkOrderInput, WorkOrderLine, WorkOrderLineInput } from '../workshop';
import { PartNotFoundError, ensurePartsExist } from './parts';
import { getReservedQuantities, getStockBalances, lockParts } from './stock';
import {
  transitionWorkOrderStatus as validateWorkOrderStatusTransition,
  type WorkOrderStatus,
} from '../work-order-status';

type WorkOrderJoinRow = {
  workOrder: typeof workOrders.$inferSelect;
  customerName: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  plate: string | null;
};

function lineValues(
  line: WorkOrderLineInput,
  tenantId: string,
  workOrderId: string,
  position: number,
  part?: typeof parts.$inferSelect,
) {
  if (!Number.isInteger(line.discountBp) || line.discountBp < 0 || line.discountBp > 10_000) {
    throw new RangeError('Der Rabatt muss zwischen 0 und 100 % liegen.');
  }
  if (!Number.isInteger(line.taxRateBp) || line.taxRateBp < 0 || line.taxRateBp > 10_000) {
    throw new RangeError('Der Steuersatz ist ungültig.');
  }

  return {
    tenantId,
    workOrderId,
    position,
    description: line.description.trim(),
    kind: line.kind,
    qtyMilli: quantityToMilli(line.quantity),
    unitPriceCents: part ? part.salePriceCents : euroToCents(line.unitPrice),
    taxRateBp: line.taxRateBp,
    discountBp: line.discountBp,
    partId: line.partId,
    purchasePriceCents: part?.purchasePriceCents ?? null,
  };
}

function mapLine(row: typeof workOrderLines.$inferSelect): WorkOrderLine {
  return {
    id: row.id,
    description: row.description,
    kind: row.kind,
    quantity: row.qtyMilli / 1_000,
    unitPrice: row.unitPriceCents / 100,
    taxRateBp: row.taxRateBp,
    discountBp: row.discountBp,
    partId: row.partId,
    purchasePriceCents: row.purchasePriceCents,
  };
}

async function hydrateWorkOrders(
  tx: UserTransaction,
  tenantId: string,
  rows: WorkOrderJoinRow[],
): Promise<WorkOrder[]> {
  if (rows.length === 0) return [];

  const ids = rows.map(({ workOrder }) => workOrder.id);
  const lineRows = await tx
    .select()
    .from(workOrderLines)
    .where(and(
      eq(workOrderLines.tenantId, tenantId),
      inArray(workOrderLines.workOrderId, ids),
    ))
    .orderBy(asc(workOrderLines.position));
  const linesByOrder = new Map<string, WorkOrderLine[]>();
  for (const row of lineRows) {
    const lines = linesByOrder.get(row.workOrderId) ?? [];
    lines.push(mapLine(row));
    linesByOrder.set(row.workOrderId, lines);
  }

  return rows.map(({ workOrder, customerName, vehicleMake, vehicleModel, plate }) => {
    if (!customerName || !vehicleMake || !plate) {
      throw new Error('Kunde oder Fahrzeug des Werkstattauftrags konnte nicht geladen werden.');
    }

    return {
      id: workOrder.id,
      number: workOrder.number,
      customerId: workOrder.customerId,
      vehicleId: workOrder.vehicleId,
      customer: customerName,
      vehicle: [vehicleMake, vehicleModel].filter(Boolean).join(' '),
      plate,
      description: workOrder.description,
      workstation: workOrder.workstation,
      mechanic: workOrder.mechanic,
      status: workOrder.status,
      lines: linesByOrder.get(workOrder.id) ?? [],
      createdAt: workOrder.createdAt.toISOString(),
    };
  });
}

export async function getWorkOrders(tenantId: string): Promise<WorkOrder[]> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const rows = await tx
      .select({
        workOrder: workOrders,
        customerName: customers.name,
        vehicleMake: vehicles.make,
        vehicleModel: vehicles.model,
        plate: vehicles.plate,
      })
      .from(workOrders)
      .innerJoin(
        customers,
        and(eq(customers.tenantId, workOrders.tenantId), eq(customers.id, workOrders.customerId)),
      )
      .innerJoin(
        vehicles,
        and(eq(vehicles.tenantId, workOrders.tenantId), eq(vehicles.id, workOrders.vehicleId)),
      )
      .where(eq(workOrders.tenantId, tenantId))
      .orderBy(desc(workOrders.createdAt));

    return hydrateWorkOrders(tx, tenantId, rows);
  });
}

export async function createWorkOrder(tenantId: string, input: WorkOrderInput): Promise<WorkOrder> {
  if (input.lines.length === 0) throw new RangeError('Ein Angebot benötigt mindestens eine Position.');

  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const [customer] = await tx
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(
        eq(customers.tenantId, tenantId),
        eq(customers.id, input.customerId),
        isNull(customers.archivedAt),
      ))
      .limit(1);
    if (!customer) throw new Error('Der ausgewählte Kunde wurde nicht gefunden.');

    const [vehicle] = await tx
      .select({
        id: vehicles.id,
        make: vehicles.make,
        model: vehicles.model,
        plate: vehicles.plate,
      })
      .from(vehicles)
      .where(and(
        eq(vehicles.tenantId, tenantId),
        eq(vehicles.customerId, customer.id),
        eq(vehicles.id, input.vehicleId),
        isNull(vehicles.archivedAt),
      ))
      .limit(1);
    if (!vehicle) throw new Error('Das ausgewählte Fahrzeug gehört nicht zum Kunden.');

    if (input.lines.some((line) => line.partId && line.kind !== 'part')) {
      throw new RangeError('Nur Materialpositionen dürfen einem Lagerartikel zugeordnet werden.');
    }
    const linkedPartIds = input.lines.flatMap((line) => line.partId ? [line.partId] : []);
    const partsById = await ensurePartsExist(tx, tenantId, linkedPartIds);

    const status = validateWorkOrderStatusTransition('draft', 'estimate');
    const number = `AU-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const [workOrder] = await tx
      .insert(workOrders)
      .values({
        tenantId,
        customerId: customer.id,
        vehicleId: vehicle.id,
        number,
        status,
        description: input.description.trim(),
        workstation: input.workstation.trim(),
        mechanic: input.mechanic.trim(),
      })
      .returning();
    if (!workOrder) throw new Error('Das Angebot konnte nicht gespeichert werden.');

    const rows = await tx
      .insert(workOrderLines)
      .values(input.lines.map((line, index) =>
        lineValues(
          line,
          tenantId,
          workOrder.id,
          index + 1,
          line.partId ? partsById.get(line.partId) : undefined,
        ),
      ))
      .returning();

    return {
      id: workOrder.id,
      number: workOrder.number,
      customerId: workOrder.customerId,
      vehicleId: workOrder.vehicleId,
      customer: customer.name,
      vehicle: [vehicle.make, vehicle.model].filter(Boolean).join(' '),
      plate: vehicle.plate,
      description: workOrder.description,
      workstation: workOrder.workstation,
      mechanic: workOrder.mechanic,
      status: workOrder.status,
      lines: rows.map(mapLine),
      createdAt: workOrder.createdAt.toISOString(),
    };
  });
}

export async function setWorkOrderStatus(
  tenantId: string,
  id: string,
  nextStatus: WorkOrderStatus,
): Promise<boolean> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    return applyWorkOrderStatus(tx, tenantId, id, nextStatus);
  });
}

/**
 * The status change itself, including the stock checks, inside a transaction that already runs as a
 * member of the workshop. Used by setWorkOrderStatus and by the customer's approval of an estimate.
 */
export async function applyWorkOrderStatus(
  tx: UserTransaction,
  tenantId: string,
  id: string,
  nextStatus: WorkOrderStatus,
): Promise<boolean> {
  const [workOrder] = await tx
    .select({ status: workOrders.status })
    .from(workOrders)
    .where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, id)))
    .for('update');
  if (!workOrder) return false;

  const status = validateWorkOrderStatusTransition(workOrder.status, nextStatus);
  if (nextStatus === 'approved' || nextStatus === 'in_progress') {
    const orderLines = await tx
      .select({
        id: workOrderLines.id,
        partId: workOrderLines.partId,
        qtyMilli: workOrderLines.qtyMilli,
      })
      .from(workOrderLines)
      .where(and(
        eq(workOrderLines.tenantId, tenantId),
        eq(workOrderLines.workOrderId, id),
        isNotNull(workOrderLines.partId),
      ));
    const trackedLines = orderLines.flatMap((line) =>
      line.partId ? [{ ...line, partId: line.partId }] : [],
    );
    const partIds = trackedLines.map((line) => line.partId);
    const lockedParts = await lockParts(tx, tenantId, partIds);
    if (lockedParts.length !== new Set(partIds).size) throw new PartNotFoundError();

    const [balances, reservations] = await Promise.all([
      getStockBalances(tx, tenantId, partIds),
      getReservedQuantities(tx, tenantId, partIds, id),
    ]);
    const partsById = new Map(lockedParts.map((part) => [part.id, part]));
    const demandByPart = new Map<string, number>();
    for (const line of trackedLines) {
      demandByPart.set(line.partId, (demandByPart.get(line.partId) ?? 0) + line.qtyMilli);
    }
    demandByPart.forEach((demandMilli, partId) => {
      const part = partsById.get(partId);
      if (!part || part.archivedAt) throw new PartNotFoundError();
      assertStockAvailable(
        part.name,
        balances.get(partId) ?? 0,
        reservations.get(partId) ?? 0,
        demandMilli,
      );
    });

    if (nextStatus === 'in_progress' && trackedLines.length > 0) {
      await tx.insert(stockMovements).values(trackedLines.map((line) => ({
        tenantId,
        partId: line.partId,
        qtyMilli: -line.qtyMilli,
        reason: 'work_order' as const,
        workOrderLineId: line.id,
      })));
    }
  }

  const [updated] = await tx
    .update(workOrders)
    .set({ status })
    .where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, id)))
    .returning({ id: workOrders.id });

  if (!updated) throw new Error('Der Werkstattauftrag konnte nicht aktualisiert werden.');
  return true;
}

export async function updateWorkOrderAssignment(
  tenantId: string,
  id: string,
  assignment: Pick<WorkOrderInput, 'workstation' | 'mechanic'>,
  options: { onlyIfMechanicUnchanged?: boolean } = {},
): Promise<boolean> {
  return withTenant(async (tx, context) => {
    assertTenantContext(tenantId, context);
    const mechanic = assignment.mechanic.trim();
    const [updated] = await tx
      .update(workOrders)
      .set({
        workstation: assignment.workstation.trim(),
        mechanic,
      })
      .where(and(
        eq(workOrders.tenantId, tenantId),
        eq(workOrders.id, id),
        options.onlyIfMechanicUnchanged ? eq(workOrders.mechanic, mechanic) : undefined,
      ))
      .returning({ id: workOrders.id });

    return Boolean(updated);
  });
}
