import 'server-only';

import { createClient } from '@supabase/supabase-js';

/**
 * The ONLY place that uses the Supabase service-role (secret) key. It bypasses all row level security, so:
 *  - it is used for staff accounts only (create, one-time password link, e-mail lookup, clean-up);
 *  - callers must have checked that the current user is the OWNER, and take the tenant from the session;
 *  - the key never leaves the server and is never logged or returned.
 */
export class AccountExistsError extends Error {
  constructor() {
    super('Diese E-Mail-Adresse ist bereits registriert.');
    this.name = 'AccountExistsError';
  }
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Der Dienstschlüssel für Mitarbeiterkonten ist nicht konfiguriert.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Creates a confirmed account without a password. The employee chooses the password via the one-time link. */
export async function createStaffAccount(email: string, displayName: string): Promise<{ id: string }> {
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error) {
    if (error.code === 'email_exists' || /already (been )?registered|already exists/i.test(error.message)) {
      throw new AccountExistsError();
    }
    throw new Error('Das Konto konnte nicht angelegt werden.');
  }
  if (!data.user) throw new Error('Das Konto konnte nicht angelegt werden.');
  return { id: data.user.id };
}

/** One-time token for the "set password" link (valid for the OTP lifetime set in Supabase, 1 hour by default). */
export async function createPasswordTokenHash(email: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.generateLink({ type: 'recovery', email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) throw new Error('Der Link konnte nicht erstellt werden.');
  return tokenHash;
}

/** E-mail addresses by user id; ids that cannot be found are left out. */
export async function getAccountEmails(userIds: readonly string[]): Promise<Map<string, string>> {
  const client = adminClient();
  const entries = await Promise.all(
    userIds.map(async (id) => {
      const { data } = await client.auth.admin.getUserById(id);
      return data?.user?.email ? ([id, data.user.email] as const) : null;
    }),
  );
  return new Map(entries.filter((entry): entry is readonly [string, string] => entry !== null));
}

/** Removes an account that was just created but could not be attached to the workshop. */
export async function deleteStaffAccount(userId: string): Promise<void> {
  await adminClient().auth.admin.deleteUser(userId);
}
