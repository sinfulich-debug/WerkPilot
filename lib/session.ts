import 'server-only';

import { and, asc, eq, isNull } from 'drizzle-orm';
import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { createClient } from './supabase/server';
import { tenantMembers } from '../db/schema';
import { withUser } from '../db/with-user';

export type Role = 'owner' | 'office' | 'mechanic';

export type SessionContext = {
  userId: string;
  tenantId: string;
  role: Role;
};

export class NoTenantError extends Error {
  constructor() {
    super('Das Benutzerkonto ist keiner Werkstatt zugeordnet.');
    this.name = 'NoTenantError';
  }
}

/**
 * No valid login: no session at all, or one that Supabase no longer accepts (signed out elsewhere,
 * revoked, expired refresh token). It extends NoTenantError on purpose: every API route already answers
 * NoTenantError with 401, so a stale session can never turn into a 500 there. Pages check this class
 * FIRST and send the user to the login page instead of "Kein Werkstattzugang".
 */
export class NotAuthenticatedError extends NoTenantError {
  constructor() {
    super();
    this.message = 'Nicht angemeldet.';
    this.name = 'NotAuthenticatedError';
  }
}

/**
 * Decides what a failed supabase.auth.getUser() means. Network trouble stays an error (it is not the
 * user's fault and must not log anybody out); everything else from Supabase Auth means "not signed in".
 */
export function toSessionError(error: unknown): Error {
  if (isAuthRetryableFetchError(error)) return error;
  if (isAuthError(error)) return new NotAuthenticatedError();
  return error instanceof Error ? error : new Error(String(error));
}

export function isDatabaseConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  return /password authentication failed|invalid password|database.*not configured|database.*unavailable|connection.*failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|timeout/i.test(
    error.message,
  );
}

export async function getSessionContext(): Promise<SessionContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw toSessionError(error);
  if (!user) throw new NotAuthenticatedError();

  const memberships = await withUser(user.id, (tx) =>
    tx
      .select({
        tenantId: tenantMembers.tenantId,
        role: tenantMembers.role,
      })
      .from(tenantMembers)
      // A deactivated employee has no workshop any more (the database hides the row as well).
      .where(and(eq(tenantMembers.userId, user.id), isNull(tenantMembers.deactivatedAt)))
      .orderBy(asc(tenantMembers.createdAt))
      .limit(1),
  );
  const membership = memberships[0];

  if (!membership) throw new NoTenantError();

  return {
    userId: user.id,
    tenantId: membership.tenantId,
    role: membership.role,
  };
}
