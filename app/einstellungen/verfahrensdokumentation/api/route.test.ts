import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveProcessAnswer } from '../../../../lib/db/process-documentation';
import { getSessionContext, NoTenantError } from '../../../../lib/session';
import { POST } from './route';

vi.mock('../../../../lib/db/process-documentation', () => ({ saveProcessAnswer: vi.fn() }));
vi.mock('../../../../lib/session', () => ({
  getSessionContext: vi.fn(),
  NoTenantError: class NoTenantError extends Error {},
}));

const tenantId = 'fedcba98-7654-3210-fedc-ba9876543210';
const userId = '01234567-89ab-cdef-0123-456789abcdef';
const saveMock = vi.mocked(saveProcessAnswer);
const sessionMock = vi.mocked(getSessionContext);

const post = (body: unknown) =>
  POST(new Request('http://localhost/einstellungen/verfahrensdokumentation/api', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));

describe('process documentation answers API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock.mockResolvedValue({ userId, tenantId, role: 'owner' });
    saveMock.mockResolvedValue();
  });

  it('saves an answer for the workshop and remembers who wrote it', async () => {
    const response = await post({ key: 'backup', answer: 'Supabase Pro, täglich, 7 Tage' });
    expect(response.status).toBe(200);
    expect(saveMock).toHaveBeenCalledWith(tenantId, userId, 'backup', 'Supabase Pro, täglich, 7 Tage');
  });

  it('trims the text and normalizes line breaks; an empty answer is passed on as empty (it removes the answer)', async () => {
    await post({ key: 'retention', answer: '  Zeile 1\r\nZeile 2  \n' });
    expect(saveMock).toHaveBeenCalledWith(tenantId, userId, 'retention', 'Zeile 1\nZeile 2');
    await post({ key: 'retention', answer: '   ' });
    expect(saveMock).toHaveBeenLastCalledWith(tenantId, userId, 'retention', '');
  });

  it('refuses unknown fields, wrong types and over-long answers with a German message', async () => {
    const unknown = await post({ key: 'drop-table', answer: 'x' });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toContain('Feld');
    expect((await post({ key: 'backup', answer: 42 })).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
    expect((await post([])).status).toBe(400);

    const tooLong = await post({ key: 'backup', answer: 'x'.repeat(4001) });
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).error).toContain('4000');
    expect((await post({ key: 'backup', answer: 'x'.repeat(4000) })).status).toBe(200);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it('is for owner and office only', async () => {
    sessionMock.mockResolvedValue({ userId, tenantId, role: 'mechanic' });
    expect((await post({ key: 'backup', answer: 'x' })).status).toBe(403);
    sessionMock.mockRejectedValue(new NoTenantError());
    expect((await post({ key: 'backup', answer: 'x' })).status).toBe(401);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('does not leak internals when saving fails', async () => {
    saveMock.mockRejectedValue(new Error('password authentication failed for user postgres'));
    const response = await post({ key: 'backup', answer: 'x' });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('postgres');
  });
});
