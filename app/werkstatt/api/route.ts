import { NextResponse } from 'next/server';
import {
  createInvoiceFromWorkOrder,
} from '../../../lib/db/invoices';
import {
  createWorkOrder,
  getWorkOrders,
  setWorkOrderStatus,
  updateWorkOrderAssignment,
} from '../../../lib/db/work-orders';
import { PartNotFoundError } from '../../../lib/db/parts';
import { euroToCents, quantityToMilli } from '../../../lib/finance';
import { StockUnavailableError } from '../../../lib/stock';
import { ForbiddenError, requireRole } from '../../../lib/requireRole';
import { NoTenantError } from '../../../lib/session';
import type { WorkOrder, WorkOrderInput, WorkOrderLine, WorkOrderLineInput } from '../../../lib/workshop';
import { isAllowedMechanic, workstations } from '../../../lib/workshop';
import { getAppointmentMechanics } from '../../../lib/db/appointments';
import {
  InvalidWorkOrderStatusTransitionError,
  workOrderStatuses,
  type WorkOrderStatus,
} from '../../../lib/work-order-status';

class ValidationError extends Error {}

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function workOrderForRole(
  workOrder: WorkOrder,
  canViewCosts: boolean,
): WorkOrder | (Omit<WorkOrder, 'lines'> & {
  lines: Array<Omit<WorkOrderLine, 'purchasePriceCents'>>;
}) {
  if (canViewCosts) return workOrder;
  return {
    ...workOrder,
    lines: workOrder.lines.map((line) => {
      const { purchasePriceCents, ...visibleLine } = line;
      void purchasePriceCents;
      return visibleLine;
    }),
  };
}

function requiredId(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ValidationError('Die Kennung ist ungültig.');
  }
  return value;
}

function requiredText(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${label} darf nicht leer sein.`);
  }
  return value.trim();
}

function requiredInteger(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(`${label} ist ungültig.`);
  }
  return value;
}

function isWorkOrderStatus(value: unknown): value is WorkOrderStatus {
  return typeof value === 'string' && workOrderStatuses.some((status) => status === value);
}

function parseLine(value: unknown, index: number): WorkOrderLineInput {
  if (!isRecord(value)) throw new ValidationError(`Position ${index + 1} ist ungültig.`);

  const kind = value.kind;
  if (kind !== 'labor' && kind !== 'part') {
    throw new ValidationError(`Der Positionstyp von Position ${index + 1} ist ungültig.`);
  }

  const description = requiredText(value, 'description', `Die Bezeichnung von Position ${index + 1}`);
  const quantity = value.quantity;
  const unitPrice = value.unitPrice;
  if (typeof quantity !== 'number' || typeof unitPrice !== 'number') {
    throw new ValidationError(`Menge oder Einzelpreis von Position ${index + 1} ist ungültig.`);
  }
  try {
    quantityToMilli(quantity);
    euroToCents(unitPrice);
  } catch {
    throw new ValidationError(`Menge oder Einzelpreis von Position ${index + 1} ist ungültig.`);
  }

  const discountBp = requiredInteger(value, 'discountBp', 'Der Rabatt');
  if (discountBp < 0 || discountBp > 10_000) {
    throw new ValidationError('Der Rabatt muss zwischen 0 und 100 % liegen.');
  }

  const taxRateBp = requiredInteger(value, 'taxRateBp', 'Der Steuersatz');
  if (![0, 700, 1_900].includes(taxRateBp)) {
    throw new ValidationError('Der Steuersatz muss 0 %, 7 % oder 19 % betragen.');
  }

  const partId = value.partId;
  if (partId !== undefined && partId !== null && (typeof partId !== 'string' || !UUID_PATTERN.test(partId))) {
    throw new ValidationError('Die Ersatzteilkennung ist ungültig.');
  }
  if (kind === 'labor' && partId) {
    throw new ValidationError('Arbeitspositionen dürfen keine Ersatzteilkennung enthalten.');
  }

  return {
    kind,
    description,
    quantity,
    unitPrice,
    discountBp,
    taxRateBp,
    partId: typeof partId === 'string' ? partId : null,
  };
}

function parseWorkOrderInput(value: unknown): WorkOrderInput {
  if (!isRecord(value)) throw new ValidationError('Ungültige Auftragsdaten.');
  if (!Array.isArray(value.lines) || value.lines.length === 0 || value.lines.length > 100) {
    throw new ValidationError('Ein Angebot benötigt mindestens eine gültige Position.');
  }

  const workstation = requiredText(value, 'workstation', 'Der Arbeitsplatz');
  const mechanic = requiredText(value, 'mechanic', 'Der Mechaniker');
  if (!workstations.includes(workstation)) throw new ValidationError('Der Arbeitsplatz ist ungültig.');

  return {
    customerId: requiredId(value, 'customerId'),
    vehicleId: requiredId(value, 'vehicleId'),
    description: requiredText(value, 'description', 'Die Arbeitsleistung'),
    workstation,
    mechanic,
    lines: value.lines.map(parseLine),
  };
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof NoTenantError) {
    return NextResponse.json({ ok: false, error: 'Keiner Werkstatt zugeordnet.' }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  if (error instanceof InvalidWorkOrderStatusTransitionError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
  }
  if (error instanceof StockUnavailableError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
  }
  if (error instanceof PartNotFoundError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
  }

  console.error('Werkstattaufträge konnten nicht verarbeitet werden.', error);
  return NextResponse.json(
    { ok: false, error: 'Werkstattaufträge konnten nicht verarbeitet werden.' },
    { status: 500 },
  );
}

async function staffNames(tenantId: string): Promise<string[]> {
  return (await getAppointmentMechanics(tenantId)).map((mechanic) => mechanic.name);
}

export async function GET() {
  try {
    const context = await requireRole(['owner', 'office', 'mechanic']);
    const workOrders = await getWorkOrders(context.tenantId);
    const mechanicNames = await staffNames(context.tenantId);
    const canViewCosts = context.role !== 'mechanic';
    return NextResponse.json({
      ok: true,
      workOrders: workOrders.map((workOrder) => workOrderForRole(workOrder, canViewCosts)),
      canViewCosts,
      mechanicNames,
      canCreateInvoice: context.role === 'owner' || context.role === 'office',
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const action = new URL(request.url).searchParams.get('action');
  const actions = [
    'createWorkOrder',
    'setWorkOrderStatus',
    'updateWorkOrderAssignment',
    'createInvoiceFromWorkOrder',
  ];
  if (!action || !actions.includes(action)) {
    return NextResponse.json({ ok: false, error: 'Unbekannte Aktion.' }, { status: 400 });
  }

  try {
    const context = await requireRole(
      action === 'createInvoiceFromWorkOrder'
        ? ['owner', 'office']
        : ['owner', 'office', 'mechanic'],
    );
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Ungültige JSON-Anfrage.');
    }
    if (!isRecord(body)) throw new ValidationError('Ungültige Anfrage.');

    switch (action) {
      case 'createWorkOrder': {
        const input = parseWorkOrderInput(body);
        if (!isAllowedMechanic(input.mechanic, await staffNames(context.tenantId))) {
          throw new ValidationError('Der Mechaniker ist ungültig.');
        }
        const workOrder = await createWorkOrder(context.tenantId, input);
        return NextResponse.json({
          ok: true,
          workOrder: workOrderForRole(workOrder, context.role !== 'mechanic'),
        });
      }
      case 'setWorkOrderStatus': {
        const id = requiredId(body, 'id');
        const status = body.status;
        if (!isWorkOrderStatus(status)) {
          throw new ValidationError('Der Auftragsstatus ist ungültig.');
        }
        const updated = await setWorkOrderStatus(context.tenantId, id, status);
        if (!updated) {
          return NextResponse.json({ ok: false, error: 'Der Werkstattauftrag wurde nicht gefunden.' }, { status: 404 });
        }
        return NextResponse.json({ ok: true });
      }
      case 'updateWorkOrderAssignment': {
        const id = requiredId(body, 'id');
        const workstation = requiredText(body, 'workstation', 'Der Arbeitsplatz');
        const mechanic = requiredText(body, 'mechanic', 'Der Mechaniker');
        if (!workstations.includes(workstation)) throw new ValidationError('Der Arbeitsplatz ist ungültig.');
        // A name that is not (or no longer) a mechanic may only stay as it is, e.g. on older orders.
        const mechanicAllowed = isAllowedMechanic(mechanic, await staffNames(context.tenantId));
        const updated = await updateWorkOrderAssignment(
          context.tenantId,
          id,
          { workstation, mechanic },
          { onlyIfMechanicUnchanged: !mechanicAllowed },
        );
        if (!updated && !mechanicAllowed) throw new ValidationError('Der Mechaniker ist ungültig.');
        if (!updated) {
          return NextResponse.json({ ok: false, error: 'Der Werkstattauftrag wurde nicht gefunden.' }, { status: 404 });
        }
        return NextResponse.json({ ok: true });
      }
      case 'createInvoiceFromWorkOrder': {
        const invoice = await createInvoiceFromWorkOrder(context.tenantId, requiredId(body, 'id'));
        return NextResponse.json({ ok: true, invoice });
      }
      default:
        return NextResponse.json({ ok: false, error: 'Unbekannte Aktion.' }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
