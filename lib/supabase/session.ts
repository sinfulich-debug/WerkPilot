import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { isAuthPage, isPublicPath } from '../public-paths';

export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error('Supabase-Umgebungsvariablen sind nicht vollständig konfiguriert.');
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  // Public: sign-in, sign-up, the e-mail links (they create the session), legal pages and the
  // customer's approval page and its API (/freigabe/<token>), see lib/public-paths.ts.
  const path = request.nextUrl.pathname;
  if (!claims && !isPublicPath(path)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    return redirectWithCookies(response, loginUrl);
  }
  if (claims && isAuthPage(path)) {
    // getClaims() only checks the token locally. A session that was revoked on the server still looks
    // valid here; without this check the user would be sent from /login to / and back to an error,
    // with no way to sign in again. One extra request, only on the login page.
    const { error } = await supabase.auth.getUser();
    if (isStaleSession(error)) {
      await supabase.auth.signOut({ scope: 'local' }); // clears the cookies through setAll above
      return response;
    }
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/';
    homeUrl.search = '';
    return redirectWithCookies(response, homeUrl);
  }

  return response;
}

/** Supabase rejected the session (not a network problem, which must not log anybody out). */
export function isStaleSession(error: unknown): boolean {
  return Boolean(error) && isAuthError(error) && !isAuthRetryableFetchError(error);
}

function redirectWithCookies(response: NextResponse, destination: URL): NextResponse {
  const redirectResponse = NextResponse.redirect(destination);
  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}
