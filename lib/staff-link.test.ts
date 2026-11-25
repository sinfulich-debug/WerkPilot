import { describe, expect, it } from 'vitest';
import { buildSetPasswordLink, passwordUpdateErrorMessage, safeNextPath, validateNewPassword } from './staff-link';

describe('passwordUpdateErrorMessage', () => {
  it('explains a re-used password instead of asking for a new link (seen in the browser: Supabase 422)', () => {
    expect(passwordUpdateErrorMessage({ code: 'same_password', status: 422 })).toMatch(/unterscheiden/);
    expect(passwordUpdateErrorMessage({ code: 'same_password' })).not.toMatch(/Link/);
  });
  it('explains a weak password', () => {
    expect(passwordUpdateErrorMessage({ code: 'weak_password', status: 422 })).toMatch(/zu schwach/);
  });
  it('asks for a new link for everything else (expired or used-up session)', () => {
    for (const error of [{ code: 'session_not_found' }, { status: 500 }, null, undefined]) {
      expect(passwordUpdateErrorMessage(error)).toMatch(/neuen Link/);
    }
  });
});

describe('buildSetPasswordLink', () => {
  it('builds a link to our own confirm route with the token', () => {
    const link = new URL(buildSetPasswordLink('https://app.example.de', 'abc123'));
    expect(link.origin).toBe('https://app.example.de');
    expect(link.pathname).toBe('/auth/confirm');
    expect(link.searchParams.get('token_hash')).toBe('abc123');
    expect(link.searchParams.get('type')).toBe('recovery');
    expect(link.searchParams.get('next')).toBe('/passwort-setzen');
  });

  it('encodes tokens with special characters', () => {
    const link = new URL(buildSetPasswordLink('http://localhost:3000', 'a&b=c d'));
    expect(link.searchParams.get('token_hash')).toBe('a&b=c d');
  });
});

describe('safeNextPath', () => {
  it('keeps same-site paths', () => {
    expect(safeNextPath('/passwort-setzen')).toBe('/passwort-setzen');
    expect(safeNextPath('/termine?x=1')).toBe('/termine?x=1');
  });

  it('refuses everything that could leave the site', () => {
    for (const bad of ['https://evil.example', '//evil.example', `/${String.fromCharCode(92)}evil.example`, 'evil', '', null, undefined, '/a\nb']) {
      expect(safeNextPath(bad as string | null | undefined)).toBe('/');
    }
    expect(safeNextPath('//x', '/home')).toBe('/home');
  });
});

describe('validateNewPassword', () => {
  it('accepts a long enough matching password', () => {
    expect(validateNewPassword('abcdefghij', 'abcdefghij')).toBeNull();
  });
  it('rejects short, too long and mismatching passwords', () => {
    expect(validateNewPassword('kurz', 'kurz')).toMatch(/mindestens 10/);
    expect(validateNewPassword('x'.repeat(73), 'x'.repeat(73))).toMatch(/höchstens 72/);
    expect(validateNewPassword('abcdefghij', 'abcdefghik')).toMatch(/stimmen nicht/);
  });
  it('accepts exactly the minimum (10) and the maximum (72) length', () => {
    expect(validateNewPassword('x'.repeat(10), 'x'.repeat(10))).toBeNull();
    expect(validateNewPassword('x'.repeat(9), 'x'.repeat(9))).toMatch(/mindestens 10/);
    expect(validateNewPassword('x'.repeat(72), 'x'.repeat(72))).toBeNull();
  });
  it('rejects an empty password and reports the length problem before a mismatch', () => {
    expect(validateNewPassword('', '')).toMatch(/mindestens 10/);
    expect(validateNewPassword('kurz', 'anders')).toMatch(/mindestens 10/);
  });
});
