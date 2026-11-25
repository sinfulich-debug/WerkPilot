/**
 * Secret token of an approval link. Server only: it uses node:crypto, which the browser cannot load
 * (the rest of the approval rules lives in estimate-approval.ts and is safe for pages).
 */
import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes = 256 bits: impossible to guess. */
export const TOKEN_BYTES = 32;

/** A new secret token for a link (goes into the URL, never into the database). */
export function generateApprovalToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** What the database stores instead of the token: SHA-256 as 64 hex characters. */
export function hashApprovalToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
