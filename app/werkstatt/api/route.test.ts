import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkOrder, getWorkOrders, updateWorkOrderAssignment } from '../../../lib/db/work-orders';
import { requireRole } from '../../../lib/requireRole';
import type { WorkOrder } from '../../../lib/workshop';
import { GET, POST } from './route';

vi.mock('../../../lib/db/invoices', () => ({
  createInvoiceFromWorkOrder: vi.fn(),
}));

vi.mock('../../../lib/db/parts', () => ({
  PartNotFoundError: class PartNotFoundError extends Error {},
}));

vi.mock('../../../lib/db/work-orders', () => ({
  createWorkOrder: vi.fn(),
  getWorkOrders: vi.fn(),
  setWorkOrderStatus: vi.fn(),
  updateWorkOrderAssignment: vi.fn(),
}));

vi.mock('../../../lib/db/appointments', () => ({
  getAppointmentMechanics: vi.fn(async () => [{ id: '11111111-1111-4111-8111-111111111111', name: 'Anna Mechanikerin' }]),
}));

vi.mock('../../../lib/requireRole', () => ({
  ForbiddenError: class ForbiddenError extends Error {},
  requireRole: vi.fn(),
}));

vi.mock('../../../lib/session', () => ({
  NoTenantError: class NoTenantError extends Error {},
}));

const createWorkOrderMock = vi.mocked(createWorkOrder);
const getWorkOrdersMock = vi.mocked(getWorkOrders);
const requireRoleMock = vi.mocked(requireRole);
const updateAssignmentMock = vi.mocked(updateWorkOrderAssignment);

const workOrder: WorkOrder = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  number: 'AU-2026-0001',
  customerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  vehicleId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  customer: 'Kunde',
  vehicle: 'VW Golf',
  plate: 'B-AB 1234',
  description: 'Bremsen erneuern',
  workstation: 'Direktannahme',
  mechanic: 'Anna Mechanikerin',
  status: 'estimate',
  lines: [{
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    description: 'Bremsbelag',
    kind: 'part',
    quantity: 1,
    unitPrice: 40,
    taxRateBp: 1_900,
    discountBp: 0,
    partId: null,
    purchasePriceCents: 2_500,
  }],
  createdAt: '2026-03-15T12:00:00.000Z',
};

const tenantId = 'fedcba98-7654-3210-fedc-ba9876543210';

function mechanicContext() {
  requireRoleMock.mockResolvedValue({
    userId: '01234567-89ab-cdef-0123-456789abcdef',
    tenantId,
    role: 'mechanic',
  });
}

describe('work orders API cost visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mechanicContext();
    getWorkOrdersMock.mockResolvedValue([workOrder]);
    createWorkOrderMock.mockResolvedValue(workOrder);
  });

  it('omits purchase prices from the mechanic work-order list', async () => {
    const response = await GET();
    const body = await response.json();

    expect(body.canViewCosts).toBe(false);
    expect(body.workOrders[0].lines[0]).not.toHaveProperty('purchasePriceCents');
  });

  it('omits purchase prices from a mechanic work-order creation response', async () => {
    const response = await POST(new Request(
      'http://localhost/werkstatt/api?action=createWorkOrder',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: workOrder.customerId,
          vehicleId: workOrder.vehicleId,
          description: workOrder.description,
          workstation: workOrder.workstation,
          mechanic: workOrder.mechanic,
          lines: [{
            kind: 'part',
            description: 'Bremsbelag',
            quantity: 1,
            unitPrice: 40,
            taxRateBp: 1_900,
            discountBp: 0,
            partId: null,
          }],
        }),
      },
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workOrder.lines[0]).not.toHaveProperty('purchasePriceCents');
  });
});

describe('work orders API mechanics', () => {
  const post = (action: string, body: unknown) => POST(new Request(`http://localhost/werkstatt/api?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  const createBody = (mechanic: string) => ({
    customerId: workOrder.customerId,
    vehicleId: workOrder.vehicleId,
    description: workOrder.description,
    workstation: workOrder.workstation,
    mechanic,
    lines: [{ kind: 'labor', description: 'Arbeit', quantity: 1, unitPrice: 90, taxRateBp: 1_900, discountBp: 0, partId: null }],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ userId: '01234567-89ab-cdef-0123-456789abcdef', tenantId, role: 'owner' });
    getWorkOrdersMock.mockResolvedValue([workOrder]);
    createWorkOrderMock.mockResolvedValue(workOrder);
  });

  it('sends the real mechanic names with the list', async () => {
    const body = await (await GET()).json();
    expect(body.mechanicNames).toEqual(['Anna Mechanikerin']);
  });

  it('accepts real staff and "Unzugewiesen", rejects invented names', async () => {
    expect((await post('createWorkOrder', createBody('Anna Mechanikerin'))).status).toBe(200);
    expect((await post('createWorkOrder', createBody('Unzugewiesen'))).status).toBe(200);
    expect((await post('createWorkOrder', createBody('Jonas Weber'))).status).toBe(400);
    expect(createWorkOrderMock).toHaveBeenCalledTimes(2);
  });

  it('keeps an old mechanic name only when it is not changed', async () => {
    updateAssignmentMock.mockResolvedValue(true);
    const id = workOrder.id;

    expect((await post('updateWorkOrderAssignment', { id, workstation: 'Direktannahme', mechanic: 'Anna Mechanikerin' })).status).toBe(200);
    expect(updateAssignmentMock).toHaveBeenLastCalledWith(tenantId, id, { workstation: 'Direktannahme', mechanic: 'Anna Mechanikerin' }, { onlyIfMechanicUnchanged: false });

    expect((await post('updateWorkOrderAssignment', { id, workstation: 'Direktannahme', mechanic: 'Jonas Weber' })).status).toBe(200);
    expect(updateAssignmentMock).toHaveBeenLastCalledWith(tenantId, id, { workstation: 'Direktannahme', mechanic: 'Jonas Weber' }, { onlyIfMechanicUnchanged: true });

    updateAssignmentMock.mockResolvedValue(false);
    expect((await post('updateWorkOrderAssignment', { id, workstation: 'Direktannahme', mechanic: 'Jonas Weber' })).status).toBe(400);
  });
});
