import type { WorkOrderStatus } from './work-order-status';

export type WorkOrderLineKind = 'labor' | 'part';

export type WorkOrderLine = {
  id: string;
  description: string;
  kind: WorkOrderLineKind;
  quantity: number;
  unitPrice: number;
  taxRateBp: number;
  discountBp: number;
  partId: string | null;
  purchasePriceCents: number | null;
};

export type WorkOrderLineInput = Omit<WorkOrderLine, 'id' | 'purchasePriceCents'>;

export type WorkOrder = {
  id: string;
  number: string;
  customerId: string;
  vehicleId: string;
  customer: string;
  vehicle: string;
  plate: string;
  description: string;
  workstation: string;
  mechanic: string;
  status: WorkOrderStatus;
  lines: WorkOrderLine[];
  createdAt: string;
};

export type WorkOrderInput = {
  customerId: string;
  vehicleId: string;
  description: string;
  workstation: string;
  mechanic: string;
  lines: WorkOrderLineInput[];
};

export interface EstimateItem {
  id: string;
  partNumber: string;
  manufacturer: string;
  description: string;
  quantity: number;
  unitNetPrice: number;
  taxRate: 0.19;
  inventoryPartId?: string;
  purchasePriceCents?: number | null;
}

export type Estimate = {
  id: string;
  customer: string;
  vehicle: string;
  service: string;
  hours: number;
  parts: number;
  items?: EstimateItem[];
  createdAt: string;
};

export const workstations = ['Reifen 1', 'Achsvermessung', 'Direktannahme'];
export const UNASSIGNED_MECHANIC = 'Unzugewiesen';

/** A work order may be given to "unassigned" or to a real mechanic of the workshop (by display name). */
export function isAllowedMechanic(name: string, staffNames: readonly string[]): boolean {
  return name === UNASSIGNED_MECHANIC || staffNames.includes(name);
}

/**
 * Choices for the mechanic select: unassigned plus the real staff. The current value is kept even when that
 * person is no longer a mechanic (older orders), so the select never shows a wrong name.
 */
export function mechanicOptions(staffNames: readonly string[], current?: string): string[] {
  const options = [UNASSIGNED_MECHANIC, ...staffNames.filter((name) => name !== UNASSIGNED_MECHANIC)];
  if (current && !options.includes(current)) options.push(current);
  return Array.from(new Set(options));
}

export function isEstimateList(value: unknown): value is Estimate[] {
  return Array.isArray(value) && value.every((estimate) => {
    if (!estimate || typeof estimate !== 'object') return false;
    const item = estimate as Record<string, unknown>;
    return typeof item.id === 'string' && typeof item.customer === 'string' &&
      typeof item.vehicle === 'string' && typeof item.service === 'string' &&
      typeof item.hours === 'number' && Number.isFinite(item.hours) && item.hours >= 0 &&
      typeof item.parts === 'number' && Number.isFinite(item.parts) && item.parts >= 0 &&
      (item.items === undefined || (Array.isArray(item.items) && item.items.every((estimateItem) => {
        if (!estimateItem || typeof estimateItem !== 'object') return false;
        const row = estimateItem as Record<string, unknown>;
        return typeof row.id === 'string' && typeof row.partNumber === 'string' &&
          typeof row.manufacturer === 'string' && typeof row.description === 'string' &&
          typeof row.quantity === 'number' && Number.isFinite(row.quantity) && row.quantity > 0 &&
          typeof row.unitNetPrice === 'number' && Number.isFinite(row.unitNetPrice) && row.unitNetPrice >= 0 &&
          row.taxRate === 0.19;
      }))) &&
      typeof item.createdAt === 'string';
  });
}
