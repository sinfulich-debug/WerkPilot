import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = {
  getClaims: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
};
let setAll: ((cookies: Array<{ name: string; value: string; options?: object }>) => void) | undefined;

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn((_url: string, _key: string, options: { cookies: { setAll: typeof setAll } }) => {
    setAll = options.cookies.setAll;
    return { auth };
  }),
}));

import { isStaleSession, updateSession } from './session';

const request = (path: string) => new NextRequest(new URL(path, 'http://localhost:3000'));
const signedIn = () => auth.getClaims.mockResolvedValue({ data: { claims: { sub: 'user' } } });
const location = (response: Response) => {
  const value = response.headers.get('location');
  return value ? new URL(value).pathname : null;
};

describe('updateSession (middleware)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-key');
    auth.signOut.mockImplementation(async () => {
      // Supabase clears the auth cookies through setAll when signing out locally
      setAll?.([{ name: 'sb-test-auth-token', value: '', options: { maxAge: 0, path: '/' } }]);
      return { error: null };
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends visitors without a session to the login page', async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: null } });
    const response = await updateSession(request('/finanzen'));
    expect(response.status).toBe(307);
    expect(location(response)).toBe('/login');
  });

  it('lets the one-time link and the login page through without a session', async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: null } });
    expect(location(await updateSession(request('/auth/confirm')))).toBeNull();
    expect(location(await updateSession(request('/login')))).toBeNull();
  });

  it('lets the customer approval page and its API through without a session, but nothing else that looks similar', async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: null } });
    const token = 'A'.repeat(43);
    expect(location(await updateSession(request(`/freigabe/${token}`)))).toBeNull();
    expect(location(await updateSession(request(`/freigabe/${token}/api`)))).toBeNull();
    // the staff API for links, the bare prefix and look-alikes still need a login
    for (const path of ['/werkstatt/freigaben/api', '/freigabe', '/freigaben/x', '/freigabex/y', '/api/workshop-settings']) {
      expect(location(await updateSession(request(path)))).toBe('/login');
    }
  });

  it('sends a signed-in user from the login page to the dashboard', async () => {
    signedIn();
    auth.getUser.mockResolvedValue({ data: { user: { id: 'user' } }, error: null });
    const response = await updateSession(request('/login'));
    expect(location(response)).toBe('/');
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('shows the login page and clears the cookies when the session was revoked on the server (no lock-out loop)', async () => {
    signedIn(); // the token still looks valid locally
    auth.getUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError('Session not found', 403, 'session_not_found') });

    const response = await updateSession(request('/login'));

    expect(location(response)).toBeNull();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(response.cookies.get('sb-test-auth-token')?.value).toBe('');
  });

  it('does not log anybody out when Supabase is only unreachable', async () => {
    signedIn();
    auth.getUser.mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError('fetch failed', 0) });
    const response = await updateSession(request('/login'));
    expect(location(response)).toBe('/');
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('asks Supabase only on the login page, not on every request', async () => {
    signedIn();
    await updateSession(request('/finanzen'));
    expect(auth.getUser).not.toHaveBeenCalled();
  });
});

describe('isStaleSession', () => {
  it('is true only for a rejected session', () => {
    expect(isStaleSession(null)).toBe(false);
    expect(isStaleSession(new AuthApiError('x', 403, 'session_not_found'))).toBe(true);
    expect(isStaleSession(new AuthRetryableFetchError('x', 0))).toBe(false);
    expect(isStaleSession(new Error('other'))).toBe(false);
  });
});
