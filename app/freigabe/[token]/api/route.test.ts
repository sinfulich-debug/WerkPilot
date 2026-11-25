import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answerApprovalLink, loadApprovalPage, lookupApprovalLink, type ApprovalLink } from '../../../../lib/db/estimate-approvals';
import { hashApprovalToken } from '../../../../lib/estimate-approval-token';
import { hitRateLimit } from '../../../../lib/db/rate-limit';
import { APPROVAL_ANSWER_LIMIT, APPROVAL_VIEW_LIMIT } from '../../../../lib/rate-limit';
import { GET, POST } from './route';

vi.mock('../../../../lib/db/estimate-approvals', () => ({
  answerApprovalLink: vi.fn(),
  loadApprovalPage: vi.fn(),
  lookupApprovalLink: vi.fn(),
}));

vi.mock('../../../../lib/db/rate-limit', () => ({ hitRateLimit: vi.fn() }));

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'; // 43 url-safe characters
const link: ApprovalLink = {
  id: '22222222-2222-4222-8222-222222222222',
  tenantId: 'fedcba98-7654-3210-fedc-ba9876543210',
  workOrderId: '11111111-1111-4111-8111-111111111111',
  createdBy: '01234567-89ab-cdef-0123-456789abcdef',
  expiresAt: new Date('2026-12-02T10:00:00.000Z'),
  decision: null,
  revokedAt: null,
  totalGrossCents: 11_900,
};
const view = {
  workshopName: 'Werkstatt GmbH', orderNumber: 'A-1', description: 'Bremsen', customerName: 'Anna Müller', vehicle: 'VW Golf', plate: 'S-AB 1',
  lines: [{ description: 'Arbeitszeit', kind: 'labor' as const, qtyMilli: 1000, unitPriceCents: 10_000, taxRateBp: 1900, discountBp: 0 }],
  netCents: 10_000, taxCents: 1_900, grossCents: 11_900, expiresAt: '2026-12-02T10:00:00.000Z',
};

const params = (token = TOKEN) => ({ params: { token } });
const post = (body: unknown, token = TOKEN) =>
  POST(new Request(`http://localhost/freigabe/${token}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), params(token));
const get = (token = TOKEN) => GET(new Request(`http://localhost/freigabe/${token}/api`), params(token));

describe('customer approval API (no login)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lookupApprovalLink).mockResolvedValue(link);
    vi.mocked(hitRateLimit).mockResolvedValue(true);
  });

  it('looks the link up by the hash of the token, never by the token itself', async () => {
    vi.mocked(loadApprovalPage).mockResolvedValue({ verdict: 'open', decision: null, view });
    await get();
    expect(lookupApprovalLink).toHaveBeenCalledWith(hashApprovalToken(TOKEN));
    expect(vi.mocked(lookupApprovalLink).mock.calls[0][0]).not.toContain(TOKEN);
  });

  it('shows the estimate of an open link without any internal data', async () => {
    vi.mocked(loadApprovalPage).mockResolvedValue({ verdict: 'open', decision: null, view });
    const response = await get();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, verdict: 'open', decision: null, message: null, view });
    expect(JSON.stringify(body).toLowerCase()).not.toMatch(/purchase|mechanic|createdby|tenant/);
  });

  it('sends private headers: no caching, no indexing, no referrer', async () => {
    vi.mocked(loadApprovalPage).mockResolvedValue({ verdict: 'open', decision: null, view });
    const response = await get();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('shows a message instead of the form when the link cannot be used', async () => {
    vi.mocked(loadApprovalPage).mockResolvedValue({ verdict: 'expired', decision: null, view });
    const body = await (await get()).json();
    expect(body.verdict).toBe('expired');
    expect(body.message).toContain('abgelaufen');
  });

  it('answers the same plain 404 for malformed and unknown tokens and does not touch the database for malformed ones', async () => {
    const malformed = await get('abc');
    expect(malformed.status).toBe(404);
    expect(lookupApprovalLink).not.toHaveBeenCalled();
    vi.mocked(lookupApprovalLink).mockResolvedValue(null);
    const unknown = await get();
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual(await malformed.json());
    expect((await post({ decision: 'declined' }, 'abc')).status).toBe(404);
  });

  it('records an approval and tells the customer only the decision', async () => {
    vi.mocked(answerApprovalLink).mockResolvedValue({ kind: 'recorded', decision: 'approved', orderApproved: false });
    const response = await post({ decision: 'approved', signerName: ' Anna  Müller ', consent: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, decision: 'approved' });
    expect(answerApprovalLink).toHaveBeenCalledWith(link, { decision: 'approved', signerName: 'Anna Müller', note: '' });
  });

  it('refuses an approval without name or consent with 400 and never reaches the database', async () => {
    expect((await post({ decision: 'approved', signerName: 'Anna Müller' })).status).toBe(400);
    expect((await post({ decision: 'approved', consent: true })).status).toBe(400);
    expect((await post({ decision: 'maybe' })).status).toBe(400);
    expect((await POST(new Request('http://localhost/x', { method: 'POST', body: '{' }), params())).status).toBe(400);
    expect(lookupApprovalLink).not.toHaveBeenCalled();
    expect(answerApprovalLink).not.toHaveBeenCalled();
  });

  it('answers 409 with the reason when the link was already used, expired, revoked or changed', async () => {
    for (const verdict of ['already_decided', 'expired', 'revoked', 'not_estimate', 'changed'] as const) {
      vi.mocked(answerApprovalLink).mockResolvedValueOnce({ kind: 'refused', verdict, decision: verdict === 'already_decided' ? 'approved' : null });
      const response = await post({ decision: 'declined' });
      const body = await response.json();
      expect(response.status).toBe(409);
      expect(body.verdict).toBe(verdict);
      expect(body.error.length).toBeGreaterThan(20);
    }
  });

  it('answers 500 with a plain message, hides the technical error and never logs the token', async () => {
    vi.mocked(answerApprovalLink).mockRejectedValueOnce(new Error('connection refused to secret-host'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await post({ decision: 'declined' });
    const logged = JSON.stringify(spy.mock.calls.map((call) => call.map(String)));
    spy.mockRestore();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('secret-host');
    expect(logged).not.toContain(TOKEN);
  });

  it('answers 429 with Retry-After and never looks the link up when the client asked too often', async () => {
    vi.mocked(hitRateLimit).mockResolvedValue(false);
    const viewed = await get();
    expect(viewed.status).toBe(429);
    expect(viewed.headers.get('retry-after')).toBe(String(APPROVAL_VIEW_LIMIT.windowSeconds));
    expect(viewed.headers.get('cache-control')).toBe('no-store');
    expect((await viewed.json()).error).toContain('Zu viele Anfragen');
    const answered = await post({ decision: 'declined' });
    expect(answered.status).toBe(429);
    expect(lookupApprovalLink).not.toHaveBeenCalled();
    expect(answerApprovalLink).not.toHaveBeenCalled();
  });

  it('counts viewing and answering under separate limits', async () => {
    vi.mocked(loadApprovalPage).mockResolvedValue({ verdict: 'open', decision: null, view });
    vi.mocked(answerApprovalLink).mockResolvedValue({ kind: 'recorded', decision: 'declined', orderApproved: false });
    await get();
    await post({ decision: 'declined' });
    expect(vi.mocked(hitRateLimit).mock.calls.map((call) => call[1])).toEqual([APPROVAL_VIEW_LIMIT, APPROVAL_ANSWER_LIMIT]);
  });

  it('lets the customer through when the limiter itself fails', async () => {
    vi.mocked(hitRateLimit).mockRejectedValue(new Error('db down'));
    vi.mocked(loadApprovalPage).mockResolvedValue({ verdict: 'open', decision: null, view });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await get();
    error.mockRestore();
    expect(response.status).toBe(200);
  });
});
