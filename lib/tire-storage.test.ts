import { describe, expect, it } from 'vitest';
import {
  buildTireReminderMessage,
  formatTreadDepth,
  getReminderWindow,
  isSeasonalReminderDue,
  isTreadLow,
  normalizeSlot,
  TireStorageValidationError,
  validateTireStorageInput,
  type TireStorageInput,
} from './tire-storage';

const valid: TireStorageInput = {
  customerId: 'c1',
  slot: ' a-3 ',
  season: 'winter',
  description: ' 205/55 R16 Continental ',
  storedAt: '2026-04-20',
};

describe('normalizeSlot', () => {
  it('ignores case and extra spaces', () => {
    expect(normalizeSlot('  a-3   2 ')).toBe('A-3 2');
  });
});

describe('getReminderWindow', () => {
  it('winter sets: 1 Oct - 30 Nov', () => {
    expect(getReminderWindow('winter', '2026-09-30')).toBeNull();
    expect(getReminderWindow('winter', '2026-10-01')).toEqual({ start: '2026-10-01', end: '2026-11-30' });
    expect(getReminderWindow('winter', '2026-11-30')).not.toBeNull();
    expect(getReminderWindow('winter', '2026-12-01')).toBeNull();
  });

  it('summer sets: 1 Mar - 30 Apr', () => {
    expect(getReminderWindow('summer', '2027-02-28')).toBeNull();
    expect(getReminderWindow('summer', '2027-03-01')).toEqual({ start: '2027-03-01', end: '2027-04-30' });
    expect(getReminderWindow('summer', '2027-05-01')).toBeNull();
  });

  it('all-season sets never have a window', () => {
    expect(getReminderWindow('allseason', '2026-10-15')).toBeNull();
  });
});

describe('isSeasonalReminderDue', () => {
  it('is due inside the window when nothing was sent', () => {
    expect(isSeasonalReminderDue({ season: 'winter' }, '2026-10-15')).toBe(true);
  });

  it('is not due when a reminder was already sent in this window', () => {
    expect(isSeasonalReminderDue({ season: 'winter', lastReminderSentAt: '2026-10-05' }, '2026-10-15')).toBe(false);
  });

  it('is due again when the last reminder is from the previous year', () => {
    expect(isSeasonalReminderDue({ season: 'winter', lastReminderSentAt: '2025-10-20' }, '2026-10-15')).toBe(true);
  });

  it('is not due outside the window or after the set was released', () => {
    expect(isSeasonalReminderDue({ season: 'winter' }, '2026-07-01')).toBe(false);
    expect(isSeasonalReminderDue({ season: 'winter', releasedAt: '2026-10-02' }, '2026-10-15')).toBe(false);
  });
});

describe('tread depth', () => {
  it('formats tenths of a millimetre', () => {
    expect(formatTreadDepth(65)).toBe('6,5 mm');
  });

  it('warns earlier for winter tires', () => {
    expect(isTreadLow('winter', 35)).toBe(true);
    expect(isTreadLow('summer', 35)).toBe(false);
    expect(isTreadLow('summer', 25)).toBe(true);
  });
});

describe('buildTireReminderMessage', () => {
  it('mentions season, plate and workshop', () => {
    const message = buildTireReminderMessage({
      customerName: 'Anna',
      season: 'winter',
      plate: 'B-AB 123',
      workshopName: 'Autohaus Muster',
    });
    expect(message).toContain('Winterreifen');
    expect(message).toContain('B-AB 123');
    expect(message).toContain('Autohaus Muster');
  });
});

describe('validateTireStorageInput', () => {
  it('cleans up valid input', () => {
    const result = validateTireStorageInput(valid);
    expect(result.slot).toBe('A-3');
    expect(result.description).toBe('205/55 R16 Continental');
  });

  it.each([
    ['empty slot', { slot: '  ' }],
    ['bad season', { season: 'spring' as never }],
    ['empty description', { description: ' ' }],
    ['impossible date', { storedAt: '2026-02-30' }],
    ['negative tread depth', { treadDepthTenthMm: -1 }],
    ['fractional tread depth', { treadDepthTenthMm: 6.5 }],
    ['tread depth too big', { treadDepthTenthMm: 151 }],
  ])('rejects %s', (_name, patch) => {
    expect(() => validateTireStorageInput({ ...valid, ...patch })).toThrow(TireStorageValidationError);
  });
});
