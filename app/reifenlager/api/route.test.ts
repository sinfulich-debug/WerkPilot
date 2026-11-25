import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTireStorage,
  listTireStorages,
  releaseTireStorage,
  SlotTakenError,
  TireStorageNotFoundError,
} from '../../../lib/db/tire-storage';
import { getSessionContext, NoTenantError } from '../../../lib/session';
import { GET, POST } from './route';

vi.mock('../../../lib/db/tire-storage', () => {
  class SlotTakenError extends Error {}
  class TireStorageNotFoundError extends Error {}
  return {
    createTireStorage: vi.fn(),
    listTireStorages: vi.fn(),
    markTireReminderSent: vi.fn(),
    releaseTireStorage: vi.fn(),
    updateTireStorage: vi.fn(),
    SlotTakenError,
    TireStorageNotFoundError,
  };
});

vi.mock('../../../lib/session', () => ({
  getSessionContext: vi.fn(),
  NoTenantError: class NoTenantError extends Error {},
}));

const getSessionContextMock = vi.mocked(getSessionContext);
const createMock = vi.mocked(createTireStorage);
const listMock = vi.mocked(listTireStorages);
const releaseMock = vi.mocked(releaseTireStorage);

const customerId = '01234567-89ab-cdef-0123-456789abcdef';
const setId = 'aaaaaaaa-89ab-cdef-0123-456789abcdef';

function post(action: string, body: unknown) {
  return POST(
    new Request(`http://localhost/reifenlager/api?action=${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

const validBody = {
  customerId,
  slot: ' a-3 ',
  season: 'winter',
  description: '205/55 R16',
  storedAt: '2026-04-20',
};

describe('tire storage API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionContextMock.mockResolvedValue({
      userId: '11111111-89ab-cdef-0123-456789abcdef',
      tenantId: 'fedcba98-7654-3210-fedc-ba9876543210',
      role: 'office',
    });
    listMock.mockResolvedValue([]);
  });

  it('answers 401 without a workshop', async () => {
    getSessionContextMock.mockRejectedValue(new NoTenantError());
    expect((await GET()).status).toBe(401);
  });

  it('lets a mechanic read but not write', async () => {
    getSessionContextMock.mockResolvedValue({
      userId: '11111111-89ab-cdef-0123-456789abcdef',
      tenantId: 'fedcba98-7654-3210-fedc-ba9876543210',
      role: 'mechanic',
    });
    expect((await GET()).status).toBe(200);
    expect((await post('create', validBody)).status).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('creates a set with a cleaned slot', async () => {
    createMock.mockResolvedValue({ id: setId } as never);
    const response = await post('create', validBody);
    expect(response.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      'fedcba98-7654-3210-fedc-ba9876543210',
      expect.objectContaining({ slot: 'A-3', customerId }),
    );
  });

  it('answers 400 for invalid input', async () => {
    expect((await post('create', { ...validBody, slot: '  ' })).status).toBe(400);
    expect((await post('create', { ...validBody, season: 'spring' })).status).toBe(400);
    expect((await post('create', { ...validBody, customerId: 'x' })).status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('answers 409 when the slot is taken', async () => {
    createMock.mockRejectedValue(new SlotTakenError());
    expect((await post('create', validBody)).status).toBe(409);
  });

  it('answers 404 when releasing an unknown set', async () => {
    releaseMock.mockRejectedValue(new TireStorageNotFoundError());
    expect((await post('release', { id: setId })).status).toBe(404);
  });

  it('answers 400 for an unknown action', async () => {
    expect((await post('explode', {})).status).toBe(400);
  });
});
