/**
 * Rate limiting for the public approval link (no login). Server only: uses node:crypto.
 * The client address is never stored: the database only sees SHA-256(scope | address).
 */
import { createHash } from 'node:crypto';

export type RateLimitRule = {
  /** Separates counters, e.g. 'freigabe-get' and 'freigabe-post' never share one. */
  scope: string;
  /** Requests allowed per window. */
  limit: number;
  windowSeconds: number;
};

/** Looking at the estimate: generous, a customer may reload the page many times. */
export const APPROVAL_VIEW_LIMIT: RateLimitRule = { scope: 'freigabe-get', limit: 60, windowSeconds: 600 };
/** Answering: a real customer answers once; a few retries are allowed. */
export const APPROVAL_ANSWER_LIMIT: RateLimitRule = { scope: 'freigabe-post', limit: 10, windowSeconds: 600 };

/**
 * The client address as the hosting platform reports it. Vercel overwrites `x-forwarded-for` with
 * the real address, so its first entry is trustworthy there. Without any header all requests share
 * the bucket 'unknown' (still limited, never unlimited).
 */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded.slice(0, 100);
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, 100);
  return 'unknown';
}

/** The key stored in the database: 64 hex characters, no readable address. */
export function rateLimitBucket(scope: string, address: string): string {
  return createHash('sha256').update(`${scope}|${address}`).digest('hex');
}
