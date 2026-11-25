import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addStaffMember, findStaffMember, listStaff, updateStaffMember } from '../../../../lib/db/staff';
import { getSessionContext, type Role } from '../../../../lib/session';
import {
  AccountExistsError,
  createPasswordTokenHash,
  createStaffAccount,
  deleteStaffAccount,
  getAccountEmails,
} from '../../../../lib/supabase/admin';
import { GET, PATCH, POST } from './route';

vi.mock('../../../../lib/session', () => ({
  getSessionContext: vi.fn(),
  NoTenantError: class NoTenantError extends Error {},
}));
vi.mock('../../../../lib/db/staff', () => ({
  listStaff: vi.fn(),
  addStaffMember: vi.fn(),
  findStaffMember: vi.fn(),
  updateStaffMember: vi.fn(),
}));
vi.mock('../../../../lib/supabase/admin', () => ({
  AccountExistsError: class AccountExistsError extends Error {
    constructor() {
      super('Diese E-Mail-Adresse ist bereits registriert.');
    }
  },
  createStaffAccount: vi.fn(),
  createPasswordTokenHash: vi.fn(),
  deleteStaffAccount: vi.fn(),
  getAccountEmails: vi.fn(),
}));

const sessionMock = vi.mocked(getSessionContext);
const listStaffMock = vi.mocked(listStaff);
const addStaffMemberMock = vi.mocked(addStaffMember);
const findStaffMemberMock = vi.mocked(findStaffMember);
const updateStaffMemberMock = vi.mocked(updateStaffMember);
const createStaffAccountMock = vi.mocked(createStaffAccount);
const createPasswordTokenHashMock = vi.mocked(createPasswordTokenHash);
const deleteStaffAccountMock = vi.mocked(deleteStaffAccount);
const getAccountEmailsMock = vi.mocked(getAccountEmails);

const TENANT = 'fedcba98-7654-3210-fedc-ba9876543210';
const OWNER = '01234567-89ab-cdef-0123-456789abcdef';
const OTHER_USER = '11111111-2222-3333-4444-555555555555';
const MEMBER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function as(role: Role) {
  sessionMock.mockResolvedValue({ userId: OWNER, tenantId: TENANT, role });
}

function json(method: 'POST' | 'PATCH', body: unknown) {
  return new Request('http://localhost:3000/einstellungen/mitarbeiter/api', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validInvite = { email: 'Neu@Werkstatt.de ', displayName: 'Neuer  Mechaniker', role: 'mechanic' };

function noStaffSideEffects() {
  expect(listStaffMock).not.toHaveBeenCalled();
  expect(createStaffAccountMock).not.toHaveBeenCalled();
  expect(addStaffMemberMock).not.toHaveBeenCalled();
  expect(updateStaffMemberMock).not.toHaveBeenCalled();
  expect(createPasswordTokenHashMock).not.toHaveBeenCalled();
  expect(getAccountEmailsMock).not.toHaveBeenCalled();
}

describe('staff API: who may use it', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it.each(['office', 'mechanic'] as const)('refuses %s on every method and touches nothing', async (role) => {
    as(role);

    const get = await GET();
    const post = await POST(json('POST', validInvite));
    const patch = await PATCH(json('PATCH', { memberId: MEMBER_ID, action: 'deactivate' }));

    for (const response of [get, post, patch]) {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ ok: false });
    }
    noStaffSideEffects();
  });

  it('answers 401 when the user belongs to no workshop', async () => {
    const { NoTenantError } = await import('../../../../lib/session');
    sessionMock.mockRejectedValue(new NoTenantError());

    expect((await GET()).status).toBe(401);
    expect((await POST(json('POST', validInvite))).status).toBe(401);
    expect((await PATCH(json('PATCH', { memberId: MEMBER_ID, action: 'link' }))).status).toBe(401);
    noStaffSideEffects();
  });

  it('answers 500 for an unexpected failure', async () => {
    as('owner');
    listStaffMock.mockRejectedValue(new Error('boom'));
    expect((await GET()).status).toBe(500);
  });
});

describe('staff API: list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    as('owner');
  });

  it('lists members with e-mail and marks the own account', async () => {
    listStaffMock.mockResolvedValue([
      { id: 'm1', userId: OWNER, displayName: 'Chef', role: 'owner', deactivatedAt: null },
      { id: 'm2', userId: OTHER_USER, displayName: null, role: 'mechanic', deactivatedAt: null },
    ]);
    getAccountEmailsMock.mockResolvedValue(new Map([[OWNER, 'chef@werkstatt.de']]));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(listStaffMock).toHaveBeenCalledWith(TENANT);
    expect(body.members).toEqual([
      { id: 'm1', displayName: 'Chef', email: 'chef@werkstatt.de', role: 'owner', deactivatedAt: null, isSelf: true },
      { id: 'm2', displayName: null, email: null, role: 'mechanic', deactivatedAt: null, isSelf: false },
    ]);
  });
});

describe('staff API: invite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    as('owner');
    createStaffAccountMock.mockResolvedValue({ id: OTHER_USER });
    addStaffMemberMock.mockResolvedValue(undefined);
    deleteStaffAccountMock.mockResolvedValue(undefined);
    createPasswordTokenHashMock.mockResolvedValue('hash-1');
  });

  it('creates account and membership, normalises input, returns a one-time link', async () => {
    const response = await POST(json('POST', validInvite));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(createStaffAccountMock).toHaveBeenCalledWith('neu@werkstatt.de', 'Neuer Mechaniker');
    expect(addStaffMemberMock).toHaveBeenCalledWith(TENANT, { userId: OTHER_USER, displayName: 'Neuer Mechaniker', role: 'mechanic' });
    expect(createPasswordTokenHashMock).toHaveBeenCalledWith('neu@werkstatt.de');
    const link = new URL(body.link);
    expect(link.origin).toBe('http://localhost:3000');
    expect(link.pathname).toBe('/auth/confirm');
    expect(link.searchParams.get('token_hash')).toBe('hash-1');
    expect(link.searchParams.get('next')).toBe('/passwort-setzen');
    expect(body.email).toBe('neu@werkstatt.de');
  });

  it('takes the workshop from the session, not from the request body', async () => {
    await POST(json('POST', { ...validInvite, tenantId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }));
    expect(addStaffMemberMock.mock.calls[0]?.[0]).toBe(TENANT);
  });

  it('may invite office, but never creates a second owner directly', async () => {
    expect((await POST(json('POST', { ...validInvite, role: 'office' }))).status).toBe(201);
    vi.clearAllMocks();
    as('owner');
    const owner = await POST(json('POST', { ...validInvite, role: 'owner' }));
    expect(owner.status).toBe(400);
    expect(createStaffAccountMock).not.toHaveBeenCalled();
  });

  it.each([
    ['missing e-mail', { displayName: 'A', role: 'mechanic' }],
    ['invalid e-mail', { email: 'kein-mail', displayName: 'A', role: 'mechanic' }],
    ['missing name', { email: 'a@b.de', role: 'mechanic' }],
    ['too long name', { email: 'a@b.de', displayName: 'x'.repeat(121), role: 'mechanic' }],
    ['unknown role', { email: 'a@b.de', displayName: 'A', role: 'admin' }],
  ])('answers 400 for %s and creates no account', async (_label, body) => {
    const response = await POST(json('POST', body));
    expect(response.status).toBe(400);
    expect(createStaffAccountMock).not.toHaveBeenCalled();
  });

  it('answers 400 for a body that is not JSON', async () => {
    const response = await POST(
      new Request('http://localhost:3000/einstellungen/mitarbeiter/api', { method: 'POST', body: 'kein json' }),
    );
    expect(response.status).toBe(400);
    expect(createStaffAccountMock).not.toHaveBeenCalled();
  });

  it('answers 409 when the e-mail already has an account', async () => {
    createStaffAccountMock.mockRejectedValue(new AccountExistsError());
    const response = await POST(json('POST', validInvite));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/bereits registriert/) });
    expect(addStaffMemberMock).not.toHaveBeenCalled();
  });

  it('removes the new account again when the membership cannot be saved', async () => {
    addStaffMemberMock.mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' }));
    const response = await POST(json('POST', validInvite));
    expect(response.status).toBe(409);
    expect(deleteStaffAccountMock).toHaveBeenCalledWith(OTHER_USER);
    expect(createPasswordTokenHashMock).not.toHaveBeenCalled();
  });

  it('still answers cleanly when the cleanup itself fails', async () => {
    addStaffMemberMock.mockRejectedValue(new Error('db down'));
    deleteStaffAccountMock.mockRejectedValue(new Error('auth down'));
    const response = await POST(json('POST', validInvite));
    expect(response.status).toBe(500);
    expect(deleteStaffAccountMock).toHaveBeenCalledTimes(1);
  });
});

describe('staff API: change a member', () => {
  const member = (overrides: Partial<{ userId: string; deactivatedAt: Date | null }> = {}) => ({
    id: MEMBER_ID,
    userId: OTHER_USER,
    displayName: 'Mitarbeiter',
    role: 'mechanic' as Role,
    deactivatedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    as('owner');
    findStaffMemberMock.mockResolvedValue(member());
    updateStaffMemberMock.mockResolvedValue(true);
    getAccountEmailsMock.mockResolvedValue(new Map([[OTHER_USER, 'mech@werkstatt.de']]));
    createPasswordTokenHashMock.mockResolvedValue('hash-2');
  });

  it.each([
    ['no member id', { action: 'deactivate' }],
    ['member id that is not a uuid', { memberId: '1; drop table', action: 'deactivate' }],
    ['unknown action', { memberId: MEMBER_ID, action: 'delete' }],
    ['role change without role', { memberId: MEMBER_ID, action: 'role' }],
    ['role change with unknown role', { memberId: MEMBER_ID, action: 'role', role: 'admin' }],
  ])('answers 400 for %s', async (_label, body) => {
    const response = await PATCH(json('PATCH', body));
    expect(response.status).toBe(400);
    expect(findStaffMemberMock).not.toHaveBeenCalled();
    expect(updateStaffMemberMock).not.toHaveBeenCalled();
  });

  it('answers 404 for a member of another workshop (lookup is scoped by tenant)', async () => {
    findStaffMemberMock.mockResolvedValue(null);
    const response = await PATCH(json('PATCH', { memberId: MEMBER_ID, action: 'deactivate' }));
    expect(response.status).toBe(404);
    expect(findStaffMemberMock).toHaveBeenCalledWith(TENANT, MEMBER_ID);
    expect(updateStaffMemberMock).not.toHaveBeenCalled();
  });

  it('changes a role and deactivates / reactivates another member', async () => {
    expect((await PATCH(json('PATCH', { memberId: MEMBER_ID, action: 'role', role: 'office' }))).status).toBe(200);
    expect(updateStaffMemberMock).toHaveBeenLastCalledWith(TENANT, { type: 'role', memberId: MEMBER_ID, role: 'office' });
    expect((await PATCH(json('PATCH', { memberId: MEMBER_ID, action: 'deactivate' }))).status).toBe(200);
    expect(updateStaffMemberMock).toHaveBeenLastCalledWith(TENANT, { type: 'deactivate', memberId: MEMBER_ID });
    expect((await PATCH(json('PATCH', { memberId: MEMBER_ID, action: 'reactivate' }))).status).toBe(200);
    expect(updateStaffMemberMock).toHaveBeenLastCalledWith(TENANT, { type: 'reactivate', memberId: MEMBER_ID });
  });

  it('does not let the owner change or deactivate their own account', async () => {
    findStaffMemberMock.mockResolvedValue(member({ userId: OWNER }));
    const demote = await PATCH(json('PATCH', { memberId: MEMBER_ID, action: 'role', role: 'office' }));
    const deactivate = await PATCH(json('PATCH', { memberId: MEMBER_ID, action: 'deactivate' }));
    expect(demote.status).toBe(400);
    expect(deactivate.status).toBe(400);
    expect(updateStaffMemberMock).not.toHaveBeenCalled();
  });

  it('answers 404 when the update matched no row', async () => {
    updateStaffMemberMock.mockResolvedValue(false);
    expect((await PATCH(json('PATCH', { memberId: MEMBER_ID, action: 'deactivate' }))).status).toBe(404);
  });

  it('answers 409 when the database refuses to remove the last owner', async () => {
    updateStaffMemberMock.mockRejectedValue(Object.assign(new Error('last owner'), { code: '23514' }));
    const response = await PATCH(json('PATCH', { memberId: MEMBER_ID, action: 'role', role: 'office' }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/letzte Inhaber/) });
  });

  it('creates a new one-time link for an active member', async () => {
    const response = await PATCH(json('PATCH', { memberId: MEMBER_ID, action: 'link' }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(createPasswordTokenHashMock).toHaveBeenCalledWith('mech@werkstatt.de');
    expect(new URL(body.link).searchParams.get('token_hash')).toBe('hash-2');
    expect(updateStaffMemberMock).not.toHaveBeenCalled();
  });

  it('refuses a link for a deactivated member and when no e-mail is known', async () => {
    findStaffMemberMock.mockResolvedValue(member({ deactivatedAt: new Date() }));
    expect((await PATCH(json('PATCH', { memberId: MEMBER_ID, action: 'link' }))).status).toBe(409);

    findStaffMemberMock.mockResolvedValue(member());
    getAccountEmailsMock.mockResolvedValue(new Map());
    expect((await PATCH(json('PATCH', { memberId: MEMBER_ID, action: 'link' }))).status).toBe(404);
    expect(createPasswordTokenHashMock).not.toHaveBeenCalled();
  });
});
