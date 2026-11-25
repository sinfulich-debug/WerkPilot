import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { safeNextPath } from '../../../lib/staff-link';
import { createClient } from '../../../lib/supabase/server';

// recovery/invite: the one-time link of a new employee. signup/email: confirming a self-registration.
const ALLOWED_TYPES: readonly EmailOtpType[] = ['recovery', 'invite', 'signup', 'email'];

/**
 * Opens a link from an e-mail and logs the user in:
 * - `token_hash` + `type` (one-time link of an employee, or a confirmation e-mail with a custom template),
 * - `code` (the default Supabase confirmation e-mail after sign-up, PKCE flow in the same browser).
 * Then leads on to `next` (an internal path only).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const code = searchParams.get('code');

  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const fallback = type === 'signup' || type === 'email' ? '/werkstatt-anlegen' : '/passwort-setzen';
    const next = safeNextPath(searchParams.get('next'), fallback);
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, origin));
  } else if (code) {
    const next = safeNextPath(searchParams.get('next'), '/werkstatt-anlegen');
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }
  return NextResponse.redirect(new URL('/login?error=link', origin));
}
