import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archivePart,
  createPart,
  getParts,
  recordStockMovement,
  updatePart,
} from '../../../lib/db/parts';
import { requireRole } from '../../../lib/requireRole';
import { StockUnavailableError } from '../../../lib/stock';
import { GET, POST } from './route';

vi.mock('../../../lib/db/parts', () => ({
  archivePart: vi.fn(),
  createPart: vi.fn(),
  getParts: vi.fn(),
  PartNotArchivableError: class PartNotArchivableError extends Error {},
  PartNotFoundError: class PartNotFoundError extends Error {},
  recordStockMovement: vi.fn(),
  updatePart: vi.fn(),
}));

vi.mock('../../../lib/requireRole', () => ({
  ForbiddenError: class ForbiddenError extends Error {},
  requireRole: vi.fn(),
}));

vi.mock('../../../lib/session', () => ({
  NoTenantError: class NoTenantError extends Error {},
}));

const requireRoleMock = vi.mocked(requireRole);
const getPartsMock = vi.mocked(getParts);
const createPartMock = vi.mocked(createPart);
const updatePartMock = vi.mocked(updatePart);
const recordStockMovementMock = vi.mocked(recordStockMovement);
const archivePartMock = vi.mocked(archivePart);

const tenantId = 'fedcba98-7654-3210-fedc-ba9876543210';
const partId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const partInput = {
  sku: 'BR-100',
  name: 'Bremsbelag vorn',
  purchasePriceCents: 2_500,
  salePriceCents: 4_000,
  minStockMilli: 2_000,
};

function post(action: string, body: unknown): Request {
  return new Request(`http://localhost/bestand/api?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('parts API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId,
      role: 'owner',
    });
    getPartsMock.mockResolvedValue([]);
    createPartMock.mockResolvedValue({
      id: partId,
      ...partInput,
      stockMilli: 3_000,
      reservedMilli: 0,
      availableMilli: 3_000,
      archivedAt: null,
    });
    updatePartMock.mockResolvedValue(null);
    recordStockMovementMock.mockResolvedValue({
      id: partId,
      ...partInput,
      stockMilli: 1_000,
      reservedMilli: 0,
      availableMilli: 1_000,
      archivedAt: null,
    });
    archivePartMock.mockResolvedValue(true);
  });

  it('lists parts within the active tenant', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(getPartsMock).toHaveBeenCalledWith(tenantId);
    await expect(response.json()).resolves.toEqual({ ok: true, parts: [], canViewCosts: true });
  });

  it('omits purchase prices from mechanic API responses', async () => {
    requireRoleMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId,
      role: 'mechanic',
    });
    getPartsMock.mockResolvedValue([{
      id: partId,
      ...partInput,
      stockMilli: 3_000,
      reservedMilli: 0,
      availableMilli: 3_000,
      archivedAt: null,
    }]);

    const response = await GET();
    const body = await response.json();

    expect(body.canViewCosts).toBe(false);
    expect(body.parts[0]).not.toHaveProperty('purchasePriceCents');

    const createResponse = await POST(post('createPart', { ...partInput, openingStockMilli: 3_000 }));
    const createBody = await createResponse.json();
    expect(createBody.part).not.toHaveProperty('purchasePriceCents');
  });

  it('creates a part with an opening purchase movement', async () => {
    const response = await POST(post('createPart', { ...partInput, openingStockMilli: 3_000 }));

    expect(response.status).toBe(200);
    expect(createPartMock).toHaveBeenCalledWith(tenantId, partInput, 3_000);
    await expect(response.json()).resolves.toMatchObject({ ok: true, part: { stockMilli: 3_000 } });
  });

  it('allows signed corrections and rejects zero quantities', async () => {
    const response = await POST(post('recordStockMovement', {
      partId,
      qtyMilli: -1_000,
      reason: 'correction',
    }));

    expect(response.status).toBe(200);
    expect(recordStockMovementMock).toHaveBeenCalledWith(tenantId, partId, -1_000, 'correction');

    const invalid = await POST(post('recordStockMovement', {
      partId,
      qtyMilli: 0,
      reason: 'correction',
    }));
    expect(invalid.status).toBe(400);
    expect(recordStockMovementMock).toHaveBeenCalledTimes(1);
  });

  it('reports insufficient inventory as a conflict', async () => {
    recordStockMovementMock.mockRejectedValue(new StockUnavailableError('Bremsbelag vorn'));

    const response = await POST(post('recordStockMovement', {
      partId,
      qtyMilli: -4_000,
      reason: 'correction',
    }));

    expect(response.status).toBe(409);
  });
});
