import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApprovalNotAllowedError,
  ApprovalOrderNotFoundError,
  createApprovalLink,
  listApprovals,
  revokeApprovalLink,
} from '../../../../lib/db/estimate-approvals';
import { ForbiddenError, requireRole } from '../../../../lib/requireRole';
import { NoTenantError } from '../../../../lib/session';
import { GET, POST } from './route';

vi.mock('../../../../lib/db/estimate-approvals', () => ({
  createApprovalLink: vi.fn(),
  listApprovals: vi.fn(),
  revokeApprovalLink: vi.fn(),
  ApprovalOrderNotFoundError: class ApprovalOrderNotFoundError extends Error {},
  ApprovalNotAllowedError: class ApprovalNotAllowedError extends Error {},
}));
vi.mock('../../../../lib/requireRole', () => ({
  requireRole: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {},
}));
vi.mock('../../../../lib/session', () => ({ NoTenantError: class NoTenantError extends Error {} }));

const tenantId = 'fedcba98-7654-3210-fedc-ba9876543210';
const orderId = '11111111-1111-4111-8111-111111111111';
const linkId = '22222222-2222-4222-8222-222222222222';
const requireRoleMock = vi.mocked(requireRole);

const post = (action: string, body: unknown) =>
  POST(new Request(`http://localhost/werkstatt/freigaben/api?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));

describe('staff API for approval links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ userId: '01234567-89ab-cdef-0123-456789abcdef', tenantId, role: 'mechanic' });
  });

  it.each(['owner', 'office', 'mechanic'] as const)('lets %s list, create and revoke', async (role) => {
    requireRoleMock.mockResolvedValue({ userId: '01234567-89ab-cdef-0123-456789abcdef', tenantId, role });
    vi.mocked(listApprovals).mockResolvedValue([]);
    vi.mocked(createApprovalLink).mockResolvedValue({ id: linkId, token: 'T'.repeat(43), expiresAt: new Date('2026-12-02T10:00:00.000Z') });
    vi.mocked(revokeApprovalLink).mockResolvedValue(true);

    expect((await GET()).status).toBe(200);
    expect((await post('create', { workOrderId: orderId })).status).toBe(201);
    expect((await post('revoke', { id: linkId })).status).toBe(200);
    expect(requireRoleMock).toHaveBeenCalledWith(['owner', 'office', 'mechanic']);
  });

  it('returns the token once, with the expiry, and forbids caching', async () => {
    vi.mocked(createApprovalLink).mockResolvedValue({ id: linkId, token: 'T'.repeat(43), expiresAt: new Date('2026-12-02T10:00:00.000Z') });
    const response = await post('create', { workOrderId: orderId });
    expect(await response.json()).toEqual({ ok: true, id: linkId, token: 'T'.repeat(43), expiresAt: '2026-12-02T10:00:00.000Z' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(createApprovalLink).toHaveBeenCalledWith(tenantId, orderId);
  });

  it('never puts a token into the list', async () => {
    vi.mocked(listApprovals).mockResolvedValue([{
      id: linkId, workOrderId: orderId, createdAt: '2026-11-18T10:00:00.000Z', expiresAt: '2026-12-02T10:00:00.000Z',
      decision: null, decidedAt: null, signerName: '', decisionNote: '', revokedAt: null,
    }]);
    const body = JSON.stringify(await (await GET()).json());
    expect(body).not.toContain('token');
    expect(listApprovals).toHaveBeenCalledWith(tenantId);
  });

  it('answers 401 without a workshop and 403 for a role that is not allowed', async () => {
    requireRoleMock.mockRejectedValueOnce(new NoTenantError());
    expect((await GET()).status).toBe(401);
    requireRoleMock.mockRejectedValueOnce(new ForbiddenError());
    expect((await post('create', { workOrderId: orderId })).status).toBe(403);
    expect(createApprovalLink).not.toHaveBeenCalled();
  });

  it('answers 400 for an unknown action, broken JSON and bad ids', async () => {
    expect((await post('delete', {})).status).toBe(400);
    expect((await POST(new Request('http://localhost/werkstatt/freigaben/api?action=create', { method: 'POST', body: '{' }))).status).toBe(400);
    expect((await post('create', { workOrderId: 'abc' })).status).toBe(400);
    expect((await post('create', [])).status).toBe(400);
    expect((await post('revoke', { id: 5 })).status).toBe(400);
    expect(createApprovalLink).not.toHaveBeenCalled();
    expect(revokeApprovalLink).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown order and 409 when it is not an estimate or the link cannot be withdrawn', async () => {
    vi.mocked(createApprovalLink).mockRejectedValueOnce(new ApprovalOrderNotFoundError());
    expect((await post('create', { workOrderId: orderId })).status).toBe(404);
    vi.mocked(createApprovalLink).mockRejectedValueOnce(new ApprovalNotAllowedError());
    expect((await post('create', { workOrderId: orderId })).status).toBe(409);
    vi.mocked(revokeApprovalLink).mockResolvedValueOnce(false);
    expect((await post('revoke', { id: linkId })).status).toBe(409);
  });

  it('answers 500 with a plain message and hides the technical error', async () => {
    vi.mocked(listApprovals).mockRejectedValueOnce(new Error('connection refused to secret-host'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await GET();
    spy.mockRestore();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('secret-host');
  });
});
