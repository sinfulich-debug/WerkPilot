import { describe, expect, it } from 'vitest';
import {
  parseRegistrationForm,
  parseWorkshopName,
  registerWorkshopOutcome,
  registrationErrorMessage,
  safeOrigin,
} from './registration';
import { isAuthPage, isPublicPath, needsWorkshop } from './public-paths';

const valid = { workshopName: '  Kfz  Müller GmbH ', email: ' Inhaber@Example.DE ', password: 'sehr-geheim-1', terms: 'on' };

describe('parseRegistrationForm', () => {
  it('cleans name and e-mail', () => {
    expect(parseRegistrationForm(valid)).toEqual({
      ok: true,
      value: { workshopName: 'Kfz Müller GmbH', email: 'inhaber@example.de', password: 'sehr-geheim-1' },
    });
  });

  it('refuses each broken field with its own code', () => {
    expect(parseRegistrationForm({ ...valid, workshopName: 'K' })).toEqual({ ok: false, error: 'name' });
    expect(parseRegistrationForm({ ...valid, email: 'kein-at' })).toEqual({ ok: false, error: 'email' });
    expect(parseRegistrationForm({ ...valid, password: 'kurz' })).toEqual({ ok: false, error: 'password' });
    expect(parseRegistrationForm({ ...valid, password: 'ü'.repeat(40) })).toEqual({ ok: false, error: 'password' });
    expect(parseRegistrationForm({ ...valid, terms: null })).toEqual({ ok: false, error: 'terms' });
  });

  it('treats non-strings and too long names as invalid', () => {
    expect(parseWorkshopName(42)).toEqual({ ok: false, error: 'name' });
    expect(parseWorkshopName('x'.repeat(201))).toEqual({ ok: false, error: 'name' });
  });
});

describe('messages and outcomes', () => {
  it('shows German text only for known codes', () => {
    expect(registrationErrorMessage('terms')).toContain('AGB');
    expect(registrationErrorMessage('toString')).toBeNull();
    expect(registrationErrorMessage('<script>')).toBeNull();
    expect(registrationErrorMessage(undefined)).toBeNull();
  });

  it('maps database refusals', () => {
    expect(registerWorkshopOutcome('23505')).toBe('has-workshop');
    expect(registerWorkshopOutcome('22023')).toBe('name');
    expect(registerWorkshopOutcome('42501')).toBe('confirm');
    expect(registerWorkshopOutcome(undefined)).toBe('failed');
  });

  it('accepts only http(s) origins', () => {
    expect(safeOrigin('https://app.werkpilot.de/x?y')).toBe('https://app.werkpilot.de');
    expect(safeOrigin('javascript:alert(1)')).toBeNull();
    expect(safeOrigin('nonsense')).toBeNull();
    expect(safeOrigin(null)).toBeNull();
  });
});

describe('public paths', () => {
  it('lets sign-up, e-mail links and approval links through without login', () => {
    for (const path of ['/login', '/registrieren', '/auth/confirm', '/freigabe/abc']) expect(isPublicPath(path)).toBe(true);
    for (const path of ['/', '/werkstatt-anlegen', '/kein-zugang', '/finanzen']) expect(isPublicPath(path)).toBe(false);
  });

  it('needs a workshop everywhere except public pages, kein-zugang and werkstatt-anlegen', () => {
    expect(needsWorkshop('/')).toBe(true);
    expect(needsWorkshop('/werkstatt-anlegen')).toBe(false);
    expect(needsWorkshop('/kein-zugang')).toBe(false);
    expect(needsWorkshop('/registrieren')).toBe(false);
  });

  it('sends logged-in users away from sign-in and sign-up only', () => {
    expect(isAuthPage('/registrieren')).toBe(true);
    expect(isAuthPage('/werkstatt-anlegen')).toBe(false);
  });
});
