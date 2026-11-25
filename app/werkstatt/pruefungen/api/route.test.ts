import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInspection,
  deleteInspection,
  deleteInspectionPhoto,
  getInspectionPhoto,
  importInspections,
  InspectionNotFoundError,
  listInspections,
  setInspectionPhoto,
  updateInspectionHeader,
  updateInspectionItem,
} from '../../../../lib/db/inspections';
import { IMPORT_BATCH_SIZE, JPEG_DATA_URL_PREFIX } from '../../../../lib/inspections';
import { getSessionContext, type Role } from '../../../../lib/session';
import { GET, POST } from './route';

vi.mock('../../../../lib/session', () => ({
  getSessionContext: vi.fn(),
  NoTenantError: class NoTenantError extends Error {},
}));
vi.mock('../../../../lib/db/inspections', () => ({
  InspectionNotFoundError: class InspectionNotFoundError extends Error {},
  createInspection: vi.fn(),
  deleteInspection: vi.fn(),
  deleteInspectionPhoto: vi.fn(),
  getInspectionPhoto: vi.fn(),
  importInspections: vi.fn(),
  listInspections: vi.fn(),
  setInspectionPhoto: vi.fn(),
  updateInspectionHeader: vi.fn(),
  updateInspectionItem: vi.fn(),
}));

const TENANT = 'fedcba98-7654-3210-fedc-ba9876543210';
const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PHOTO = `${JPEG_DATA_URL_PREFIX}QUJD`;
const sessionMock = vi.mocked(getSessionContext);
const as = (role: Role) => sessionMock.mockResolvedValue({ userId: '01234567-89ab-cdef-0123-456789abcdef', tenantId: TENANT, role });

const post = (action: string, body: unknown) =>
  new Request(`http://localhost/werkstatt/pruefungen/api?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const get = (query = '') => new Request(`http://localhost/werkstatt/pruefungen/api${query}`);

const inspection = { id: ID, customerName: '', vehicleLabel: '', plate: '', createdAt: '2026-11-18T10:00:00.000Z', items: [] };

describe('inspections API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    as('mechanic');
    vi.mocked(listInspections).mockResolvedValue([inspection]);
    vi.mocked(createInspection).mockResolvedValue(inspection);
    vi.mocked(importInspections).mockImplementation(async (_tenant, list) => list.length);
  });

  it('lets a mechanic list, create and fill in inspections', async () => {
    expect((await GET(get())).status).toBe(200);
    expect(listInspections).toHaveBeenCalledWith(TENANT);

    const created = await POST(post('create', { customerName: ' Anna ', plate: 's-a 1' }));
    expect(created.status).toBe(201);
    expect(createInspection).toHaveBeenCalledWith(TENANT, { customerName: 'Anna', vehicleLabel: '', plate: 'S-A 1' });

    expect((await POST(post('updateHeader', { id: ID, customerName: 'Anna', vehicleLabel: 'Golf' }))).status).toBe(200);
    expect(updateInspectionHeader).toHaveBeenCalledWith(TENANT, ID, { customerName: 'Anna', vehicleLabel: 'Golf', plate: '' });
    expect((await POST(post('updateItem', { itemId: ID, status: 'rot', note: 'sofort' }))).status).toBe(200);
    expect(updateInspectionItem).toHaveBeenCalledWith(TENANT, ID, { status: 'rot', note: 'sofort' });
    expect((await POST(post('setPhoto', { itemId: ID, photo: PHOTO }))).status).toBe(200);
    expect(setInspectionPhoto).toHaveBeenCalledWith(TENANT, ID, PHOTO);
    expect((await POST(post('deletePhoto', { itemId: ID }))).status).toBe(200);
    expect(deleteInspectionPhoto).toHaveBeenCalledWith(TENANT, ID);
  });

  it('refuses deleting a whole inspection to a mechanic and calls nothing', async () => {
    const response = await POST(post('delete', { id: ID }));
    expect(response.status).toBe(403);
    expect(deleteInspection).not.toHaveBeenCalled();
  });

  it.each(['owner', 'office'] as const)('lets %s delete an inspection', async (role) => {
    as(role);
    expect((await POST(post('delete', { id: ID }))).status).toBe(200);
    expect(deleteInspection).toHaveBeenCalledWith(TENANT, ID);
  });

  it('returns a photo only on request, and 404 when there is none', async () => {
    vi.mocked(getInspectionPhoto).mockResolvedValueOnce(PHOTO).mockResolvedValueOnce(null);
    const found = await GET(get(`?photo=${ID}`));
    expect(await found.json()).toEqual({ ok: true, photo: PHOTO });
    expect((await GET(get(`?photo=${ID}`))).status).toBe(404);
    expect((await GET(get('?photo=../etc'))).status).toBe(400);
  });

  it.each([
    ['unknown action', 'drop', {}],
    ['invalid inspection id', 'updateHeader', { id: 'pruefung-1' }],
    ['invalid item id', 'updateItem', { itemId: 42, status: 'rot' }],
    ['unknown status', 'updateItem', { itemId: ID, status: 'blau' }],
    ['empty change', 'updateItem', { itemId: ID }],
    ['png photo', 'setPhoto', { itemId: ID, photo: 'data:image/png;base64,QUJD' }],
    ['plate too long', 'create', { plate: 'X'.repeat(21) }],
    ['import without list', 'import', {}],
  ])('answers 400 for %s and saves nothing', async (_label, action, body) => {
    const response = await POST(post(action, body));
    expect(response.status).toBe(400);
    for (const fn of [createInspection, updateInspectionHeader, updateInspectionItem, setInspectionPhoto, importInspections]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('answers 400 for a body that is not JSON', async () => {
    const response = await POST(new Request('http://localhost/werkstatt/pruefungen/api?action=create', { method: 'POST', body: '{' }));
    expect(response.status).toBe(400);
  });

  it('answers 404 for an inspection or item of another workshop', async () => {
    vi.mocked(updateInspectionItem).mockRejectedValue(new InspectionNotFoundError('Der Prüfpunkt wurde nicht gefunden.'));
    expect((await POST(post('updateItem', { itemId: ID, note: 'x' }))).status).toBe(404);
  });

  it('answers 400 when the database refuses a value (check constraint)', async () => {
    vi.mocked(setInspectionPhoto).mockRejectedValue(Object.assign(new Error('check'), { code: '23514' }));
    expect((await POST(post('setPhoto', { itemId: ID, photo: PHOTO }))).status).toBe(400);
  });

  it('answers 401 without workshop and 500 for unexpected errors', async () => {
    const { NoTenantError } = await import('../../../../lib/session');
    sessionMock.mockRejectedValueOnce(new NoTenantError());
    expect((await GET(get())).status).toBe(401);
    vi.mocked(listInspections).mockRejectedValueOnce(new Error('boom'));
    expect((await GET(get())).status).toBe(500);
  });

  describe('import of the old browser data', () => {
    const legacy = (id: string) => ({ id, customer: 'Anna', vehicle: 'Golf', plate: 'S-A 1', items: [{ label: 'Bremsanlage', status: 'gelb', note: '' }] });

    it('imports a batch, skips the demo entry and reports what happened', async () => {
      const response = await POST(post('import', { inspections: [legacy('a'), legacy('pruefung-1'), { kaputt: true }] }));
      expect(await response.json()).toEqual({ ok: true, imported: 1, skipped: 1 });
      expect(vi.mocked(importInspections).mock.calls[0]?.[1]).toHaveLength(1);
    });

    it('refuses batches that are too large (each entry may carry photos)', async () => {
      const list = Array.from({ length: IMPORT_BATCH_SIZE + 1 }, (_, index) => legacy(`x${index}`));
      const response = await POST(post('import', { inspections: list }));
      expect(response.status).toBe(400);
      expect(importInspections).not.toHaveBeenCalled();
    });
  });
});
