import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppointmentConflictError,
  InvalidAppointmentMechanicError,
  getAppointmentMechanics,
  createAppointment,
  deleteAppointment,
  getAppointments,
  updateAppointment,
} from '../../../lib/db/appointments';
import { getSessionContext } from '../../../lib/session';
import { GET, POST } from './route';

vi.mock('../../../lib/db/appointments', () => ({
  AppointmentConflictError: class AppointmentConflictError extends Error {
    constructor() {
      super('Der Termin überschneidet sich mit einem anderen Termin.');
    }
  },
  InvalidAppointmentMechanicError: class InvalidAppointmentMechanicError extends Error {
    constructor(message = 'Der ausgewählte Mechaniker gehört nicht zu dieser Werkstatt.') {
      super(message);
    }
  },
  getAppointmentMechanics: vi.fn(),
  createAppointment: vi.fn(),
  deleteAppointment: vi.fn(),
  getAppointments: vi.fn(),
  updateAppointment: vi.fn(),
}));

vi.mock('../../../lib/session', () => ({
  getSessionContext: vi.fn(),
  NoTenantError: class NoTenantError extends Error {},
}));

const getSessionContextMock = vi.mocked(getSessionContext);
const getAppointmentsMock = vi.mocked(getAppointments);
const getAppointmentMechanicsMock = vi.mocked(getAppointmentMechanics);
const createAppointmentMock = vi.mocked(createAppointment);
const updateAppointmentMock = vi.mocked(updateAppointment);
const deleteAppointmentMock = vi.mocked(deleteAppointment);

const tenantId = 'fedcba98-7654-3210-fedc-ba9876543210';
const appointmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const appointmentForm = {
  customer: 'Anna Müller',
  vehicle: 'VW Golf',
  plate: 'S-WN 1234',
  durationMinutes: 60,
  bay: 'Direktannahme',
  reason: 'HU',
  date: '2026-11-20',
  time: '09:30',
  status: 'Bestätigt' as const,
};

function post(action: string, body: unknown): Request {
  return new Request(`http://localhost/termine/api?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('appointments API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionContextMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId,
      role: 'owner',
    });
    getAppointmentsMock.mockResolvedValue([]);
    getAppointmentMechanicsMock.mockResolvedValue([]);
    deleteAppointmentMock.mockResolvedValue();
  });

  it('loads appointments for the active tenant', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(getAppointmentsMock).toHaveBeenCalledWith(tenantId);
    await expect(response.json()).resolves.toEqual({ ok: true, appointments: [], mechanics: [] });
  });

  it('allows mechanics to read and create appointments', async () => {
    getSessionContextMock.mockResolvedValue({
      userId: '01234567-89ab-cdef-0123-456789abcdef',
      tenantId,
      role: 'mechanic',
    });
    createAppointmentMock.mockResolvedValue({
      id: appointmentId,
      ...appointmentForm,
      tone: 'success',
    });

    const getResponse = await GET();
    const postResponse = await POST(post('createAppointment', appointmentForm));

    expect(getResponse.status).toBe(200);
    expect(postResponse.status).toBe(200);
    expect(createAppointmentMock).toHaveBeenCalledWith(tenantId, appointmentForm);
  });

  it('trims and creates an appointment for the active tenant', async () => {
    createAppointmentMock.mockResolvedValue({
      id: appointmentId,
      ...appointmentForm,
      tone: 'success',
    });

    const response = await POST(post('createAppointment', {
      ...appointmentForm,
      customer: ' Anna Müller ',
      vehicle: ' VW Golf ',
      plate: ' S-WN 1234 ',
    }));

    expect(response.status).toBe(200);
    expect(createAppointmentMock).toHaveBeenCalledWith(tenantId, appointmentForm);
  });

  it.each([
    [{ ...appointmentForm, customer: ' ' }, 'Der Kunde'],
    [{ ...appointmentForm, vehicle: '' }, 'Das Fahrzeug'],
    [{ ...appointmentForm, plate: ' ' }, 'Das Kennzeichen'],
    [{ ...appointmentForm, durationMinutes: 0 }, 'Dauer'],
    [{ ...appointmentForm, bay: ' ' }, 'Arbeitsplatz'],
    [{ ...appointmentForm, bay: 'x'.repeat(121) }, '120 Zeichen'],
    [{ ...appointmentForm, mechanicId: 'not-a-uuid' }, 'mechanicId'],
    [{ ...appointmentForm, date: '2026-02-31' }, 'YYYY-MM-DD'],
    [{ ...appointmentForm, time: '25:00' }, 'HH:MM'],
  ])('rejects invalid appointment form fields', async (body, expectedError) => {
    const response = await POST(post('createAppointment', body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining(expectedError),
    });
    expect(createAppointmentMock).not.toHaveBeenCalled();
  });

  it('updates and deletes appointments using tenant-scoped IDs', async () => {
    updateAppointmentMock.mockResolvedValue({
      id: appointmentId,
      ...appointmentForm,
      tone: 'success',
    });

    const updateResponse = await POST(post('updateAppointment', {
      id: appointmentId,
      ...appointmentForm,
    }));
    const deleteResponse = await POST(post('deleteAppointment', { id: appointmentId }));

    expect(updateResponse.status).toBe(200);
    expect(updateAppointmentMock).toHaveBeenCalledWith(tenantId, appointmentId, appointmentForm);
    expect(deleteResponse.status).toBe(200);
    expect(deleteAppointmentMock).toHaveBeenCalledWith(tenantId, appointmentId);
  });

  it('returns a conflict response when the bay or mechanic is already booked', async () => {
    createAppointmentMock.mockRejectedValue(new AppointmentConflictError());

    const response = await POST(post('createAppointment', appointmentForm));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('überschneidet'),
    });
  });

  it('rejects a mechanic who is not a member of the workshop', async () => {
    createAppointmentMock.mockRejectedValue(new InvalidAppointmentMechanicError());

    const response = await POST(post('createAppointment', {
      ...appointmentForm,
      mechanicId: '01234567-89ab-cdef-0123-456789abcdef',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('Mechaniker'),
    });
  });
});
