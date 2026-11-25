import { describe, expect, it } from 'vitest';
import {
  REMINDER_OPT_OUT_NOTICE,
  canSendReminder,
  getReminderConsentState,
  isConsentSource,
  withOptOutNotice,
} from './reminder-consent';

describe('getReminderConsentState', () => {
  it('is "none" when nothing was recorded', () => {
    expect(getReminderConsentState({})).toBe('none');
    expect(canSendReminder({})).toBe(false);
  });

  it('is "granted" after a consent', () => {
    const fields = { reminderConsentAt: '2026-11-01T10:00:00Z', reminderConsentSource: 'verbal' as const };
    expect(getReminderConsentState(fields)).toBe('granted');
    expect(canSendReminder(fields)).toBe(true);
  });

  it('is "revoked" when the opt-out is newer than the consent', () => {
    const fields = { reminderConsentAt: '2026-11-01T10:00:00Z', reminderOptOutAt: '2026-11-05T10:00:00Z' };
    expect(getReminderConsentState(fields)).toBe('revoked');
    expect(canSendReminder(fields)).toBe(false);
  });

  it('is "granted" again when the customer consents after an opt-out', () => {
    const fields = { reminderConsentAt: '2026-11-10T10:00:00Z', reminderOptOutAt: '2026-11-05T10:00:00Z' };
    expect(getReminderConsentState(fields)).toBe('granted');
  });

  it('treats an opt-out at the same moment as a consent as revoked', () => {
    const at = '2026-11-01T10:00:00Z';
    expect(getReminderConsentState({ reminderConsentAt: at, reminderOptOutAt: at })).toBe('revoked');
  });

  it('is "revoked" for an opt-out without any consent', () => {
    expect(getReminderConsentState({ reminderOptOutAt: '2026-11-05T10:00:00Z' })).toBe('revoked');
  });

  it('ignores a date that cannot be read instead of allowing sending', () => {
    expect(canSendReminder({ reminderConsentAt: 'kein Datum' })).toBe(false);
  });
});

describe('withOptOutNotice', () => {
  it('appends the STOP hint on its own paragraph', () => {
    expect(withOptOutNotice('Guten Tag.\n')).toBe(`Guten Tag.\n\n${REMINDER_OPT_OUT_NOTICE}`);
  });

  it('does not add the hint twice', () => {
    const once = withOptOutNotice('Guten Tag.');
    expect(withOptOutNotice(once)).toBe(once);
  });
});

describe('isConsentSource', () => {
  it('accepts only the known sources', () => {
    expect(isConsentSource('verbal')).toBe(true);
    expect(isConsentSource('written')).toBe(true);
    expect(isConsentSource('form')).toBe(true);
    expect(isConsentSource('telepathy')).toBe(false);
    expect(isConsentSource(undefined)).toBe(false);
  });
});
