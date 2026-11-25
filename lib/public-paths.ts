import { isApprovalPath } from './estimate-approval';

/**
 * Addresses that work without a login: sign-in, sign-up, e-mail links, legal pages, the Stripe webhook
 * (checks Stripe's signature itself) and the customer's approval link.
 */
const NO_LOGIN_PATHS = new Set([
  '/login', '/registrieren', '/auth/confirm', '/impressum', '/datenschutz', '/agb', '/api/stripe/webhook',
]);

/** Pages for a logged-in user who does not belong to a workshop (yet). */
const NO_WORKSHOP_PATHS = new Set(['/kein-zugang', '/werkstatt-anlegen']);

/** Sign-in and sign-up: a logged-in user is sent on to the dashboard. */
const AUTH_PAGES = new Set(['/login', '/registrieren']);

export function isPublicPath(path: string): boolean {
  return NO_LOGIN_PATHS.has(path) || isApprovalPath(path);
}

/** True when the page needs a workshop membership (the layout sends everyone else to /kein-zugang). */
export function needsWorkshop(path: string): boolean {
  return !isPublicPath(path) && !NO_WORKSHOP_PATHS.has(path);
}

export function isAuthPage(path: string): boolean {
  return AUTH_PAGES.has(path);
}
