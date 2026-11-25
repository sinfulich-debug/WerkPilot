import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getUser = vi.fn();
vi.mock('./supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser } })),
}));

const memberships = vi.fn();
vi.mock('../db/with-user', () => ({
  withUser: vi.fn(async () => memberships()),
}));

import {
  getSessionContext,
  isDatabaseConnectionError,
  NoTenantError,
  NotAuthenticatedError,
  toSessionError,
} from './session';

const USER_ID = '01234567-89ab-cdef-0123-456789abcdef';
const TENANT_ID = 'fedcba98-7654-3210-fedc-ba9876543210';

describe('isDatabaseConnectionError', () => {
  it('detects PostgreSQL authentication failures', () => {
    expect(isDatabaseConnectionError(new Error('password authentication failed for user "postgres"'))).toBe(true);
  });

  it('ignores unrelated session errors', () => {
    expect(isDatabaseConnectionError(new NoTenantError())).toBe(false);
    expect(isDatabaseConnectionError(new NotAuthenticatedError())).toBe(false);
  });
});

describe('NotAuthenticatedError', () => {
  it('is a NoTenantError, so every API route answers 401 instead of 500', () => {
    const error = new NotAuthenticatedError();
    expect(error).toBeInstanceOf(NoTenantError);
    expect(error.name).toBe('NotAuthenticatedError');
    expect(error.message).toBe('Nicht angemeldet.');
  });
});

describe('toSessionError', () => {
  it('treats a missing or rejected session as "not signed in"', () => {
    expect(toSessionError(new AuthSessionMissingError())).toBeInstanceOf(NotAuthenticatedError);
    expect(toSessionError(new AuthApiError('Session not found', 403, 'session_not_found'))).toBeInstanceOf(NotAuthenticatedError);
    expect(toSessionError(new AuthApiError('Invalid JWT', 401, 'bad_jwt'))).toBeInstanceOf(NotAuthenticatedError);
  });

  it('keeps network trouble as an error (nobody is logged out because Supabase is unreachable)', () => {
    const network = new AuthRetryableFetchError('fetch failed', 0);
    expect(toSessionError(network)).toBe(network);
    expect(toSessionError(network)).not.toBeInstanceOf(NoTenantError);
  });

  it('passes other errors through', () => {
    const other = new Error('boom');
    expect(toSessionError(other)).toBe(other);
    expect(toSessionError('text')).toBeInstanceOf(Error);
  });
});

describe('getSessionContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns user, workshop and role of the active membership', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    memberships.mockResolvedValue([{ tenantId: TENANT_ID, role: 'mechanic' }]);
    await expect(getSessionContext()).resolves.toEqual({ userId: USER_ID, tenantId: TENANT_ID, role: 'mechanic' });
  });

  it('throws NotAuthenticatedError for a session that was signed out on the server (seen in the browser)', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError('Session from session_id claim in JWT does not exist', 403, 'session_not_found') });
    await expect(getSessionContext()).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(memberships).not.toHaveBeenCalled();
  });

  it('throws NotAuthenticatedError without any session and without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    await expect(getSessionContext()).rejects.toBeInstanceOf(NotAuthenticatedError);
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(getSessionContext()).rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it('keeps a network error as an error', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError('fetch failed', 0) });
    await expect(getSessionContext()).rejects.toBeInstanceOf(AuthRetryableFetchError);
  });

  it('throws a plain NoTenantError (not NotAuthenticatedError) for a signed-in user without workshop or a deactivated one', async () => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    memberships.mockResolvedValue([]);
    const error = await getSessionContext().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NoTenantError);
    expect(error).not.toBeInstanceOf(NotAuthenticatedError);
  });
});
