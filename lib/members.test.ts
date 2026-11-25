import { describe, expect, it } from 'vitest';
import {
  canManageStaff,
  isAlreadyRegisteredMessage,
  keepsLinkAfterChange,
  memberLabel,
  parseInviteInput,
  parseMemberChange,
  sortStaff,
  type StaffMember,
} from './members';

const ID = '3e849952-1e8e-439f-8150-ba936efe851e';

describe('keepsLinkAfterChange (green link box stayed visible after deactivation in the browser)', () => {
  const link = 'jonas.weber@example.com';
  it('hides the link of the member that was just deactivated (e-mail case does not matter)', () => {
    expect(keepsLinkAfterChange(link, { email: 'jonas.weber@example.com' }, 'deactivate')).toBe(false);
    expect(keepsLinkAfterChange(link, { email: ' Jonas.Weber@Example.com ' }, 'deactivate')).toBe(false);
  });
  it('keeps the link when somebody else is deactivated or the change is no deactivation', () => {
    expect(keepsLinkAfterChange(link, { email: 'other@example.com' }, 'deactivate')).toBe(true);
    expect(keepsLinkAfterChange(link, { email: link }, 'role')).toBe(true);
    expect(keepsLinkAfterChange(link, { email: link }, 'reactivate')).toBe(true);
  });
  it('keeps the link when the member has no known e-mail', () => {
    expect(keepsLinkAfterChange(link, { email: null }, 'deactivate')).toBe(true);
  });
});

describe('parseInviteInput', () => {
  it('accepts a valid invite and normalizes e-mail and name', () => {
    expect(parseInviteInput({ email: '  Max.Muster@Example.DE ', displayName: '  Max   Muster ', role: 'mechanic' })).toEqual({
      ok: true,
      value: { email: 'max.muster@example.de', displayName: 'Max Muster', role: 'mechanic' },
    });
  });

  it('rejects a bad e-mail, a missing name and an overlong name', () => {
    expect(parseInviteInput({ email: 'kein-mail', displayName: 'Max', role: 'office' })).toMatchObject({ ok: false });
    expect(parseInviteInput({ email: 'a@b.de', displayName: '   ', role: 'office' })).toMatchObject({ ok: false });
    expect(parseInviteInput({ email: 'a@b.de', displayName: 'x'.repeat(121), role: 'office' })).toMatchObject({ ok: false });
    expect(parseInviteInput({ email: 'a@b.de', displayName: 'x'.repeat(120), role: 'office' })).toMatchObject({ ok: true });
  });

  it('only allows office and mechanic for a new employee', () => {
    expect(parseInviteInput({ email: 'a@b.de', displayName: 'Max', role: 'owner' })).toMatchObject({ ok: false });
    expect(parseInviteInput({ email: 'a@b.de', displayName: 'Max', role: 'admin' })).toMatchObject({ ok: false });
    expect(parseInviteInput({ email: 'a@b.de', displayName: 'Max' })).toMatchObject({ ok: false });
  });

  it('survives garbage input', () => {
    expect(parseInviteInput(null)).toMatchObject({ ok: false });
    expect(parseInviteInput('text')).toMatchObject({ ok: false });
    expect(parseInviteInput({ email: 5, displayName: [], role: {} })).toMatchObject({ ok: false });
  });
});

describe('parseMemberChange', () => {
  it('parses role change, deactivate and reactivate', () => {
    expect(parseMemberChange({ memberId: ID, action: 'role', role: 'owner' })).toEqual({
      ok: true,
      value: { type: 'role', memberId: ID, role: 'owner' },
    });
    expect(parseMemberChange({ memberId: ID, action: 'deactivate' })).toEqual({ ok: true, value: { type: 'deactivate', memberId: ID } });
    expect(parseMemberChange({ memberId: ID, action: 'reactivate' })).toEqual({ ok: true, value: { type: 'reactivate', memberId: ID } });
    expect(parseMemberChange({ memberId: ID, action: 'link' })).toEqual({ ok: true, value: { type: 'link', memberId: ID } });
  });

  it('rejects a bad id, an unknown action and an unknown role', () => {
    expect(parseMemberChange({ memberId: '123', action: 'deactivate' })).toMatchObject({ ok: false });
    expect(parseMemberChange({ memberId: ID, action: 'delete' })).toMatchObject({ ok: false });
    expect(parseMemberChange({ memberId: ID, action: 'role', role: 'boss' })).toMatchObject({ ok: false });
    expect(parseMemberChange(undefined)).toMatchObject({ ok: false });
  });
});

describe('canManageStaff', () => {
  it('is only true for the owner', () => {
    expect(canManageStaff('owner')).toBe(true);
    expect(canManageStaff('office')).toBe(false);
    expect(canManageStaff('mechanic')).toBe(false);
  });
});

describe('memberLabel and sortStaff', () => {
  const member = (id: string, displayName: string | null, role: StaffMember['role'], deactivated = false): StaffMember => ({
    id,
    displayName,
    role,
    deactivatedAt: deactivated ? new Date('2026-11-01') : null,
    isSelf: false,
  });

  it('falls back to a neutral label when there is no name', () => {
    expect(memberLabel({ id: ID, displayName: null })).toBe('Mitarbeiter 3e849952');
    expect(memberLabel({ id: ID, displayName: '  ' })).toBe('Mitarbeiter 3e849952');
    expect(memberLabel({ id: ID, displayName: 'Anna' })).toBe('Anna');
  });

  it('sorts active before deactivated, then owner, office, mechanic, then by name', () => {
    const sorted = sortStaff([
      member('1', 'Zoe', 'mechanic'),
      member('2', 'Anna', 'mechanic'),
      member('3', 'Bernd', 'office'),
      member('4', 'Chef', 'owner'),
      member('5', 'Alt', 'owner', true),
    ]);
    expect(sorted.map((m) => m.displayName)).toEqual(['Chef', 'Bernd', 'Anna', 'Zoe', 'Alt']);
  });

  it('does not change the input array', () => {
    const input = [member('1', 'B', 'mechanic'), member('2', 'A', 'owner')];
    sortStaff(input);
    expect(input.map((m) => m.id)).toEqual(['1', '2']);
  });
});

describe('isAlreadyRegisteredMessage', () => {
  it('recognizes the usual wordings', () => {
    expect(isAlreadyRegisteredMessage('A user with this email address has already been registered')).toBe(true);
    expect(isAlreadyRegisteredMessage('email_exists')).toBe(true);
    expect(isAlreadyRegisteredMessage('Rate limit exceeded')).toBe(false);
  });
});
