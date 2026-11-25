import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAbsence,
  deleteAbsence,
  getAbsences,
  getCalendarSettings,
  saveCalendarSettings,
} from '../../../../lib/db/calendar';
import { getSessionContext } from '../../../../lib/session';
import { GET, POST } from './route';

vi.mock('../../../../lib/db/calendar', () => ({
  InvalidAbsenceMechanicError: class InvalidAbsenceMechanicError extends Error {},
  WorkshopProfileMissingError: class WorkshopProfileMissingError extends Error {},
  getCalendarSettings: vi.fn(),
  getAbsences: vi.fn(),
  saveCalendarSettings: vi.fn(),
  createAbsence: vi.fn(),
  deleteAbsence: vi.fn(),
}));

vi.mock('../../../../lib/session', () => ({
  getSessionContext: vi.fn(),
  NoTenantError: class NoTenantError extends Error {},
}));

const getSessionContextMock = vi.mocked(getSessionContext);
const tenantId = 'fedcba98-7654-3210-fedc-ba9876543210';
const mechanicId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const settings = { bundesland: 'BY', workStart: '07:30', workEnd: '16:30', lunchStart: '12:00', lunchEnd: '12:45' };

function post(action: string, body: unknown): Request {
  return new Request(`http://localhost/termine/kalender/api?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function asRole(role: 'owner' | 'office' | 'mechanic') {
  getSessionContextMock.mockResolvedValue({ userId: '01234567-89ab-cdef-0123-456789abcdef', tenantId, role });
}

describe('calendar settings and absences API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asRole('owner');
    vi.mocked(getCalendarSettings).mockResolvedValue(settings as never);
    vi.mocked(getAbsences).mockResolvedValue([]);
  });

  it('lets every role read the settings and absences', async () => {
    asRole('mechanic');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, settings, absences: [], canEdit: false });
    expect(getCalendarSettings).toHaveBeenCalledWith(tenantId);
  });

  it('tells owner and office that they may edit', async () => {
    for (const role of ['owner', 'office'] as const) {
      asRole(role);
      expect((await (await GET()).json()).canEdit).toBe(true);
    }
  });

  it('saves valid settings for the owner', async () => {
    const response = await POST(post('saveSettings', settings));
    expect(response.status).toBe(200);
    expect(saveCalendarSettings).toHaveBeenCalledWith(tenantId, settings);
  });

  it('answers 400 with a German message for invalid settings', async () => {
    const response = await POST(post('saveSettings', { ...settings, workStart: '18:00' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Arbeitsbeginn');
    expect(saveCalendarSettings).not.toHaveBeenCalled();
  });

  it('refuses every change from a mechanic with 403', async () => {
    asRole('mechanic');
    for (const [action, body] of [
      ['saveSettings', settings],
      ['createAbsence', { mechanicId, startDate: '2026-12-21', endDate: '2026-12-23', type: 'Urlaub' }],
      ['deleteAbsence', { id: mechanicId }],
    ] as const) {
      const response = await POST(post(action, body));
      expect(response.status).toBe(403);
    }
    expect(saveCalendarSettings).not.toHaveBeenCalled();
    expect(createAbsence).not.toHaveBeenCalled();
    expect(deleteAbsence).not.toHaveBeenCalled();
  });

  it('creates and deletes an absence for office staff', async () => {
    asRole('office');
    const absence = { id: 'x', mechanicId, startDate: '2026-12-21', endDate: '2026-12-23', type: 'Urlaub' as const };
    vi.mocked(createAbsence).mockResolvedValue(absence);

    const created = await POST(post('createAbsence', { ...absence, id: undefined }));
    expect(created.status).toBe(200);
    expect((await created.json()).absence).toEqual(absence);
    expect(createAbsence).toHaveBeenCalledWith(tenantId, {
      mechanicId,
      startDate: '2026-12-21',
      endDate: '2026-12-23',
      type: 'Urlaub',
      note: undefined,
    });

    const deleted = await POST(post('deleteAbsence', { id: mechanicId }));
    expect(deleted.status).toBe(200);
    expect(deleteAbsence).toHaveBeenCalledWith(tenantId, mechanicId);
  });

  it('rejects an invalid absence, an invalid id and an unknown action with 400', async () => {
    const badAbsence = await POST(post('createAbsence', { mechanicId, startDate: '2026-12-23', endDate: '2026-12-21', type: 'Urlaub' }));
    expect(badAbsence.status).toBe(400);
    expect((await badAbsence.json()).error).toContain('Enddatum');

    expect((await POST(post('deleteAbsence', { id: 'nope' }))).status).toBe(400);
    expect((await POST(post('dropEverything', {}))).status).toBe(400);
    expect(createAbsence).not.toHaveBeenCalled();
    expect(deleteAbsence).not.toHaveBeenCalled();
  });
});
