/**
 * Privacy filter for error reports sent to Sentry (DSGVO). Pure functions, safe for browser and server.
 * - The secret token of an approval link (/freigabe/<token>) never leaves the app.
 * - No cookies, headers, request bodies, query strings or IP addresses.
 */

const APPROVAL_TOKEN = /\/freigabe\/[^/?#\s"']+/g;

/** Replaces every approval token in a text with a placeholder. */
export function redactApprovalTokens(text: string): string {
  return text.replace(APPROVAL_TOKEN, '/freigabe/[token]');
}

/** A URL without its query string and without approval tokens. */
export function scrubUrl(url: string): string {
  return redactApprovalTokens(url.split(/[?#]/)[0] ?? '');
}

type Frame = { filename?: string; abs_path?: string };
type ExceptionValue = { value?: string; stacktrace?: { frames?: Frame[] } };
type Breadcrumb = { message?: string; data?: Record<string, unknown> };

/** The parts of a Sentry event we touch (kept structural so this file needs no Sentry types). */
export type ScrubbableEvent = {
  message?: string;
  transaction?: string;
  request?: { url?: string; query_string?: unknown; cookies?: unknown; headers?: unknown; data?: unknown; env?: unknown };
  user?: unknown;
  exception?: { values?: ExceptionValue[] };
  breadcrumbs?: Breadcrumb[];
  tags?: Record<string, unknown>;
};

export function scrubBreadcrumb<T extends Breadcrumb>(breadcrumb: T): T {
  if (breadcrumb.message) breadcrumb.message = redactApprovalTokens(breadcrumb.message);
  if (breadcrumb.data) {
    for (const key of ['url', 'to', 'from']) {
      const value = breadcrumb.data[key];
      if (typeof value === 'string') breadcrumb.data[key] = scrubUrl(value);
    }
  }
  return breadcrumb;
}

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.message) event.message = redactApprovalTokens(event.message);
  if (event.transaction) event.transaction = redactApprovalTokens(event.transaction);
  if (event.request) {
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.env;
  }
  delete event.user;
  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = redactApprovalTokens(value.value);
    for (const frame of value.stacktrace?.frames ?? []) {
      if (frame.filename) frame.filename = redactApprovalTokens(frame.filename);
      if (frame.abs_path) frame.abs_path = redactApprovalTokens(frame.abs_path);
    }
  }
  event.breadcrumbs?.forEach(scrubBreadcrumb);
  if (event.tags) {
    for (const [key, value] of Object.entries(event.tags)) {
      if (typeof value === 'string') event.tags[key] = redactApprovalTokens(value);
    }
  }
  return event;
}

/** Settings shared by browser, server and edge. Sentry stays off while no DSN is configured. */
export function sentryOptions(dsn: string | undefined) {
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0, // errors only, no performance tracing
    beforeSend: <E extends ScrubbableEvent>(event: E) => scrubEvent(event),
    beforeBreadcrumb: <B extends Breadcrumb>(breadcrumb: B) => scrubBreadcrumb(breadcrumb),
  };
}
