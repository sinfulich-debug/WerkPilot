import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCustomer,
  createVehicle,
  getCustomers,
  getVehicles,
  getArchivedCustomers,
  getArchivedVehicles,
  recordReminderConsent,
  recordReminderOptOut,
  restoreCustomer,
  restoreVehicle,
  updateCustomer,
} from '../../../lib/db/customers';
import { getSessionContext } from '../../../lib/session';
import { GET, POST } from './route';

vi.mock('../../../lib/db/customers', () => ({
  createCustomer: vi.fn(),
  createVehicle: vi.fn(),
  deleteCustomer: vi.fn(),
  deleteVehicle: vi.fn(),
  getArchivedCustomers: vi.fn(),
  getArchivedVehicles: vi.fn(),
  getCustomers: vi.fn(),
  getVehicles: vi.fn(),
  markReminderSent: vi.fn(),
  recordReminderConsent: vi.fn(),
  recordReminderOptOut: vi.fn(),
  restoreCustomer: vi.fn(),
  restoreVehicle: vi.fn(),
  updateCustomer: vi.fn(),
  updateVehicle: vi.fn(),
}));

vi.mock('../../../lib/session', () => ({
  getSessionContext: vi.fn(),
  NoTenantError: class NoTenantError extends Error {},
}));

const getSessionContextMock = vi.mocked(getSessionContext);
const getCustomersMock = vi.mocked(getCustomers);
const getVehiclesMock = vi.mocked(getVehicles);
const getArchivedCustomersMock = vi.mocked(getArchivedCustomers);
const getArchivedVehiclesMock = vi.mocked(getArchivedVehicles);
const createCustomerMock = vi.mocked(createCustomer);
const createVehicleMock = vi.mocked(createVehicle);
const updateCustomerMock = vi.mocked(updateCustomer);
const restoreCustomerMock = vi.mocked(restoreCustomer);
const restoreVehicleMock = vi.mocked(restoreVehicle);

describe('customers API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionContextMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId: 'fedcba98-7654-3210-fedc-ba9876543210',
      role: 'owner',
    });
    getCustomersMock.mockResolvedValue([]);
    getVehiclesMock.mockResolvedValue([]);
    getArchivedCustomersMock.mockResolvedValue([]);
    getArchivedVehiclesMock.mockResolvedValue([]);
    restoreCustomerMock.mockResolvedValue(true);
    restoreVehicleMock.mockResolvedValue(true);
  });

  it('loads customers and vehicles for the active tenant', async () => {
    const response = await GET(new Request('http://localhost/kunden/api'));

    expect(response.status).toBe(200);
    expect(getCustomersMock).toHaveBeenCalledWith('fedcba98-7654-3210-fedc-ba9876543210');
    expect(getVehiclesMock).toHaveBeenCalledWith('fedcba98-7654-3210-fedc-ba9876543210');
    await expect(response.json()).resolves.toEqual({ ok: true, customers: [], vehicles: [] });
  });

  it('allows mechanics to read customers and vehicles', async () => {
    getSessionContextMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId: 'fedcba98-7654-3210-fedc-ba9876543210',
      role: 'mechanic',
    });

    const response = await GET(new Request('http://localhost/kunden/api'));

    expect(response.status).toBe(200);
    expect(getCustomersMock).toHaveBeenCalledWith('fedcba98-7654-3210-fedc-ba9876543210');
    expect(getVehiclesMock).toHaveBeenCalledWith('fedcba98-7654-3210-fedc-ba9876543210');
  });

  it('loads archived customers and vehicles on request', async () => {
    const response = await GET(new Request('http://localhost/kunden/api?archived=true'));

    expect(response.status).toBe(200);
    expect(getArchivedCustomersMock).toHaveBeenCalledWith('fedcba98-7654-3210-fedc-ba9876543210');
    expect(getArchivedVehiclesMock).toHaveBeenCalledWith('fedcba98-7654-3210-fedc-ba9876543210');
    expect(getCustomersMock).not.toHaveBeenCalled();
    expect(getVehiclesMock).not.toHaveBeenCalled();
  });

  it.each([
    ['restoreCustomer', restoreCustomerMock],
    ['restoreVehicle', restoreVehicleMock],
  ])('restores an archived record with the %s action', async (action, restoreMock) => {
    const response = await POST(
      new Request(`http://localhost/kunden/api?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(restoreMock).toHaveBeenCalledWith(
      'fedcba98-7654-3210-fedc-ba9876543210',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
  });

  describe('reminder consent', () => {
    const customerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const tenantId = 'fedcba98-7654-3210-fedc-ba9876543210';
    const post = (action: string, body: unknown) =>
      POST(
        new Request(`http://localhost/kunden/api?action=${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );

    it('records a consent with its source', async () => {
      vi.mocked(recordReminderConsent).mockResolvedValue(true);
      const response = await post('recordReminderConsent', { customerId, source: 'verbal' });
      expect(response.status).toBe(200);
      expect(recordReminderConsent).toHaveBeenCalledWith(tenantId, customerId, 'verbal');
    });

    it('rejects a consent without a known source', async () => {
      const response = await post('recordReminderConsent', { customerId, source: 'telepathy' });
      expect(response.status).toBe(400);
      expect(recordReminderConsent).not.toHaveBeenCalled();
    });

    it('answers 404 when the customer does not exist', async () => {
      vi.mocked(recordReminderConsent).mockResolvedValue(false);
      const response = await post('recordReminderConsent', { customerId, source: 'form' });
      expect(response.status).toBe(404);
    });

    it('records an opt-out', async () => {
      vi.mocked(recordReminderOptOut).mockResolvedValue(true);
      const response = await post('recordReminderOptOut', { customerId });
      expect(response.status).toBe(200);
      expect(recordReminderOptOut).toHaveBeenCalledWith(tenantId, customerId);
    });

    it('does not let mechanics change consent', async () => {
      getSessionContextMock.mockResolvedValue({
        userId: '01234567-89ab-cdef-0123-456789abcdef',
        tenantId,
        role: 'mechanic',
      });
      const response = await post('recordReminderOptOut', { customerId });
      expect(response.status).toBe(403);
      expect(recordReminderOptOut).not.toHaveBeenCalled();
    });
  });

  it('prevents mechanics from writing customers', async () => {
    getSessionContextMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId: 'fedcba98-7654-3210-fedc-ba9876543210',
      role: 'mechanic',
    });

    const response = await POST(
      new Request('http://localhost/kunden/api?action=createCustomer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Anna Müller', phone: '' }),
      }),
    );

    expect(response.status).toBe(403);
    expect(createCustomerMock).not.toHaveBeenCalled();
  });

  it('trims and creates a customer with an email', async () => {
    createCustomerMock.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Anna Müller',
      phone: '',
      email: 'anna@example.de',
    });

    const response = await POST(
      new Request('http://localhost/kunden/api?action=createCustomer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ' Anna Müller ', phone: ' ', email: ' anna@example.de ' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(createCustomerMock).toHaveBeenCalledWith(
      'fedcba98-7654-3210-fedc-ba9876543210',
      { name: 'Anna Müller', phone: '', email: 'anna@example.de', notes: undefined },
    );
  });

  it('creates a customer without an email', async () => {
    createCustomerMock.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Anna Müller',
      phone: '',
      email: '',
    });

    const response = await POST(
      new Request('http://localhost/kunden/api?action=createCustomer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Anna Müller', phone: '' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(createCustomerMock).toHaveBeenCalledWith(
      'fedcba98-7654-3210-fedc-ba9876543210',
      { name: 'Anna Müller', phone: '', email: '', notes: undefined },
    );
  });

  it('allows clearing a customer email during update', async () => {
    updateCustomerMock.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Anna Müller',
      phone: '',
      email: '',
    });

    const response = await POST(
      new Request('http://localhost/kunden/api?action=updateCustomer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Anna Müller',
          phone: '',
          email: '',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateCustomerMock).toHaveBeenCalledWith(
      'fedcba98-7654-3210-fedc-ba9876543210',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      { name: 'Anna Müller', phone: '', email: '', notes: undefined },
    );
  });

  it.each([
    ['createCustomer', 'anna.example.de'],
    ['updateCustomer', 'anna.example.de'],
  ])('rejects an email without @ for %s', async (action, email) => {
    const response = await POST(
      new Request(`http://localhost/kunden/api?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Anna Müller',
          phone: '',
          email,
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('E-Mail-Adresse'),
    });
    expect(createCustomerMock).not.toHaveBeenCalled();
    expect(updateCustomerMock).not.toHaveBeenCalled();
  });

  it('trims and updates a customer email', async () => {
    updateCustomerMock.mockResolvedValue({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Anna Müller',
      phone: '',
      email: 'anna@example.de',
    });

    const response = await POST(
      new Request('http://localhost/kunden/api?action=updateCustomer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Anna Müller',
          phone: '',
          email: ' anna@example.de ',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateCustomerMock).toHaveBeenCalledWith(
      'fedcba98-7654-3210-fedc-ba9876543210',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      { name: 'Anna Müller', phone: '', email: 'anna@example.de', notes: undefined },
    );
  });

  it('rejects invalid HU dates before creating a vehicle', async () => {
    const response = await POST(
      new Request('http://localhost/kunden/api?action=createVehicle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          make: 'VW Golf',
          plate: 'S-WN 1234',
          tuvDueDate: '2026-02-31',
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(createVehicleMock).not.toHaveBeenCalled();
  });
});
