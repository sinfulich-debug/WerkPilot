import type { Role } from './session';

/** Pure helpers for the staff page (invite, change role, deactivate). No database access here. */

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Inhaber',
  office: 'Büro',
  mechanic: 'Mechaniker',
};

/** Roles an owner may give to a NEW employee. A second owner is made by changing the role afterwards. */
export const INVITABLE_ROLES: readonly Role[] = ['office', 'mechanic'];
export const ALL_ROLES: readonly Role[] = ['owner', 'office', 'mechanic'];

export const MAX_NAME_LENGTH = 120;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export type InviteInput = { email: string; displayName: string; role: Role };

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ALL_ROLES as readonly string[]).includes(value);
}

/** Only the owner manages staff. */
export function canManageStaff(role: Role): boolean {
  return role === 'owner';
}

function readString(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

export function parseInviteInput(body: unknown): ParseResult<InviteInput> {
  const email = (readString(body, 'email') ?? '').trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return { ok: false, message: 'Bitte eine gültige E-Mail-Adresse angeben.' };
  }

  const displayName = (readString(body, 'displayName') ?? '').trim().replace(/\s+/g, ' ');
  if (!displayName) return { ok: false, message: 'Bitte einen Namen angeben.' };
  if (displayName.length > MAX_NAME_LENGTH) {
    return { ok: false, message: `Der Name darf höchstens ${MAX_NAME_LENGTH} Zeichen lang sein.` };
  }

  const role = readString(body, 'role');
  if (!isRole(role) || !INVITABLE_ROLES.includes(role)) {
    return { ok: false, message: 'Bitte die Rolle Büro oder Mechaniker wählen.' };
  }

  return { ok: true, value: { email, displayName, role } };
}

export type MemberChange =
  | { type: 'role'; memberId: string; role: Role }
  | { type: 'deactivate'; memberId: string }
  | { type: 'reactivate'; memberId: string }
  | { type: 'link'; memberId: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseMemberChange(body: unknown): ParseResult<MemberChange> {
  const memberId = readString(body, 'memberId');
  if (!memberId || !UUID_PATTERN.test(memberId)) {
    return { ok: false, message: 'Der Mitarbeiter ist ungültig.' };
  }

  const action = readString(body, 'action');
  if (action === 'deactivate') return { ok: true, value: { type: 'deactivate', memberId } };
  if (action === 'reactivate') return { ok: true, value: { type: 'reactivate', memberId } };
  if (action === 'link') return { ok: true, value: { type: 'link', memberId } };
  if (action === 'role') {
    const role = readString(body, 'role');
    if (!isRole(role)) return { ok: false, message: 'Die Rolle ist ungültig.' };
    return { ok: true, value: { type: 'role', memberId, role } };
  }
  return { ok: false, message: 'Die Aktion ist ungültig.' };
}

export type StaffMember = {
  id: string;
  displayName: string | null;
  role: Role;
  deactivatedAt: Date | string | null;
  isSelf: boolean;
};

/** Name for the list: the stored name, or a neutral fallback for members made before names existed. */
export function memberLabel(member: Pick<StaffMember, 'displayName' | 'id'>): string {
  const name = member.displayName?.trim();
  return name ? name : `Mitarbeiter ${member.id.slice(0, 8)}`;
}

/** Active members first (owner, office, mechanic), deactivated ones at the end, then by name. */
export function sortStaff<T extends StaffMember>(members: readonly T[]): T[] {
  const order: Record<Role, number> = { owner: 0, office: 1, mechanic: 2 };
  return [...members].sort((a, b) => {
    const activeDiff = Number(a.deactivatedAt !== null) - Number(b.deactivatedAt !== null);
    if (activeDiff !== 0) return activeDiff;
    const roleDiff = order[a.role] - order[b.role];
    if (roleDiff !== 0) return roleDiff;
    return memberLabel(a).localeCompare(memberLabel(b), 'de');
  });
}

/**
 * After deactivating a member, the green box with their one-time link must disappear: the link no longer
 * gets them in (they land on "Kein Werkstattzugang"), and sending it would only confuse.
 * E-mail addresses are compared case-insensitively.
 */
export function keepsLinkAfterChange(
  linkEmail: string,
  member: { email: string | null },
  action: MemberChange['type'],
): boolean {
  if (action !== 'deactivate') return true;
  if (!member.email) return true;
  return member.email.trim().toLowerCase() !== linkEmail.trim().toLowerCase();
}

/** Supabase answers "already registered" in a few wordings; treat them all the same. */
export function isAlreadyRegisteredMessage(message: string): boolean {
  return /already (been )?registered|already exists|email_exists/i.test(message);
}
