import { NextResponse } from 'next/server';
import { addStaffMember, findStaffMember, listStaff, updateStaffMember } from '../../../../lib/db/staff';
import { getDatabaseErrorCode, PG_CHECK_VIOLATION, PG_UNIQUE_VIOLATION } from '../../../../lib/db-error';
import { parseInviteInput, parseMemberChange } from '../../../../lib/members';
import { ForbiddenError, requireRole } from '../../../../lib/requireRole';
import { NoTenantError } from '../../../../lib/session';
import { buildSetPasswordLink } from '../../../../lib/staff-link';
import {
  AccountExistsError,
  createPasswordTokenHash,
  createStaffAccount,
  deleteStaffAccount,
  getAccountEmails,
} from '../../../../lib/supabase/admin';

// Staff management. OWNER ONLY. The tenant always comes from the session, never from the request.

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function handleError(error: unknown, fallback: string) {
  if (error instanceof NoTenantError) return fail(401, 'Keiner Werkstatt zugeordnet.');
  if (error instanceof ForbiddenError) return fail(403, 'Nur der Inhaber darf Mitarbeiter verwalten.');
  if (error instanceof AccountExistsError) return fail(409, error.message);
  const code = getDatabaseErrorCode(error);
  if (code === PG_CHECK_VIOLATION) {
    return fail(409, 'Der letzte Inhaber einer Werkstatt kann nicht entfernt oder herabgestuft werden.');
  }
  if (code === PG_UNIQUE_VIOLATION) return fail(409, 'Dieser Mitarbeiter ist bereits eingetragen.');
  console.error(fallback, error);
  return fail(500, fallback);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function GET() {
  try {
    const { tenantId, userId } = await requireRole(['owner']);
    const rows = await listStaff(tenantId);
    const emails = await getAccountEmails(rows.map((row) => row.userId));
    return NextResponse.json({
      ok: true,
      members: rows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        email: emails.get(row.userId) ?? null,
        role: row.role,
        deactivatedAt: row.deactivatedAt,
        isSelf: row.userId === userId,
      })),
    });
  } catch (error) {
    return handleError(error, 'Die Mitarbeiter konnten nicht geladen werden.');
  }
}

/** Invite: creates the account, attaches it to this workshop and returns a one-time "set password" link. */
export async function POST(request: Request) {
  try {
    const { tenantId } = await requireRole(['owner']);
    const parsed = parseInviteInput(await readJson(request));
    if (!parsed.ok) return fail(400, parsed.message);
    const { email, displayName, role } = parsed.value;

    const account = await createStaffAccount(email, displayName);
    try {
      await addStaffMember(tenantId, { userId: account.id, displayName, role });
    } catch (error) {
      // Do not leave an account behind that belongs to no workshop.
      await deleteStaffAccount(account.id).catch((cleanupError) =>
        console.error('Das neue Konto konnte nicht wieder entfernt werden.', cleanupError),
      );
      throw error;
    }

    const tokenHash = await createPasswordTokenHash(email);
    const link = buildSetPasswordLink(new URL(request.url).origin, tokenHash);
    return NextResponse.json({ ok: true, link, email }, { status: 201 });
  } catch (error) {
    return handleError(error, 'Der Mitarbeiter konnte nicht eingeladen werden.');
  }
}

/** Change role, deactivate, reactivate, or create a fresh one-time link for an existing member. */
export async function PATCH(request: Request) {
  try {
    const { tenantId, userId } = await requireRole(['owner']);
    const parsed = parseMemberChange(await readJson(request));
    if (!parsed.ok) return fail(400, parsed.message);
    const change = parsed.value;

    const member = await findStaffMember(tenantId, change.memberId);
    if (!member) return fail(404, 'Der Mitarbeiter wurde nicht gefunden.');

    if (change.type === 'link') {
      if (member.deactivatedAt) return fail(409, 'Der Mitarbeiter ist deaktiviert.');
      const email = (await getAccountEmails([member.userId])).get(member.userId);
      if (!email) return fail(404, 'Zu diesem Mitarbeiter gibt es keine E-Mail-Adresse.');
      const tokenHash = await createPasswordTokenHash(email);
      return NextResponse.json({
        ok: true,
        link: buildSetPasswordLink(new URL(request.url).origin, tokenHash),
        email,
      });
    }

    if (member.userId === userId && (change.type === 'deactivate' || change.type === 'role')) {
      return fail(400, 'Das eigene Konto kann hier nicht geändert werden. Bitte einen anderen Inhaber bitten.');
    }

    const updated = await updateStaffMember(tenantId, change);
    if (!updated) return fail(404, 'Der Mitarbeiter wurde nicht gefunden.');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error, 'Die Änderung konnte nicht gespeichert werden.');
  }
}
