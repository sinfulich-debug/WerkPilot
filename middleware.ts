import { type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/session';

export async function middleware(request: NextRequest) {
  request.headers.set('x-werkpilot-pathname', request.nextUrl.pathname);
  return updateSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)',
  ],
};
