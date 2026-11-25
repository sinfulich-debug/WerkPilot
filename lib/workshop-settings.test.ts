import { describe, expect, it } from 'vitest';
import {
  centsToEuros,
  DEFAULT_HOURLY_RATE_CENTS,
  DEFAULT_WHATSAPP_TEMPLATE,
  defaultTaxMode,
  eurosToCentsOrNull,
  isWorkshopSettings,
  MAX_HOURLY_RATE_CENTS,
  MAX_WHATSAPP_TEMPLATE_LENGTH,
  parseHourlyRateCents,
  parseWhatsappTemplate,
  toWorkshopSettings,
} from './workshop-settings';

describe('parseHourlyRateCents', () => {
  it('accepts whole cents inside the range, including the borders', () => {
    expect(parseHourlyRateCents(9_500)).toEqual({ ok: true, value: 9_500 });
    expect(parseHourlyRateCents(0)).toEqual({ ok: true, value: 0 });
    expect(parseHourlyRateCents(MAX_HOURLY_RATE_CENTS)).toEqual({ ok: true, value: MAX_HOURLY_RATE_CENTS });
  });

  it('refuses floats, text, missing values and out-of-range numbers', () => {
    for (const bad of [95.5, '9500', null, undefined, NaN, Infinity, -1, MAX_HOURLY_RATE_CENTS + 1]) {
      expect(parseHourlyRateCents(bad).ok).toBe(false);
    }
  });
});

describe('parseWhatsappTemplate', () => {
  it('trims the text', () => {
    expect(parseWhatsappTemplate('  Hallo {Kundenname}  ')).toEqual({ ok: true, value: 'Hallo {Kundenname}' });
  });

  it('turns an empty text into null, which means "use the default"', () => {
    expect(parseWhatsappTemplate('')).toEqual({ ok: true, value: null });
    expect(parseWhatsappTemplate('   \n ')).toEqual({ ok: true, value: null });
  });

  it('refuses a text that is too long and anything that is not text', () => {
    expect(parseWhatsappTemplate('x'.repeat(MAX_WHATSAPP_TEMPLATE_LENGTH)).ok).toBe(true);
    expect(parseWhatsappTemplate('x'.repeat(MAX_WHATSAPP_TEMPLATE_LENGTH + 1)).ok).toBe(false);
    expect(parseWhatsappTemplate(5).ok).toBe(false);
    expect(parseWhatsappTemplate(null).ok).toBe(false);
  });
});

describe('eurosToCentsOrNull and centsToEuros', () => {
  it('rounds to whole cents without float errors', () => {
    expect(eurosToCentsOrNull(95)).toBe(9_500);
    expect(eurosToCentsOrNull(19.99)).toBe(1_999);
    expect(eurosToCentsOrNull(0.1 + 0.2)).toBe(30);
    expect(eurosToCentsOrNull(0)).toBe(0);
  });

  it('gives null for values that cannot be a price', () => {
    for (const bad of [-1, NaN, Infinity, '95', null, undefined, Number.MAX_VALUE]) {
      expect(eurosToCentsOrNull(bad)).toBeNull();
    }
  });

  it('converts back for display', () => {
    expect(centsToEuros(9_500)).toBe(95);
    expect(centsToEuros(1_999)).toBe(19.99);
  });
});

describe('defaultTaxMode', () => {
  it('uses the small-business rule only when the workshop has it', () => {
    expect(defaultTaxMode(true)).toBe('smallBusiness');
    expect(defaultTaxMode(false)).toBe('standard19');
  });
});

describe('isWorkshopSettings', () => {
  const valid = toWorkshopSettings({ companyName: 'Werkstatt' });

  it('accepts what toWorkshopSettings produces', () => {
    expect(isWorkshopSettings(valid)).toBe(true);
  });

  it('refuses missing or wrongly typed fields', () => {
    expect(isWorkshopSettings(null)).toBe(false);
    expect(isWorkshopSettings({})).toBe(false);
    expect(isWorkshopSettings({ ...valid, hourlyRateCents: 95.5 })).toBe(false);
    expect(isWorkshopSettings({ ...valid, hourlyRateCents: '9500' })).toBe(false);
    expect(isWorkshopSettings({ ...valid, iban: null })).toBe(false);
    expect(isWorkshopSettings({ ...valid, isSmallBusiness: 'ja' })).toBe(false);
  });
});

describe('toWorkshopSettings', () => {
  it('fills every gap with defaults for a workshop without a profile', () => {
    expect(toWorkshopSettings(null)).toEqual({
      companyName: '',
      hourlyRateCents: DEFAULT_HOURLY_RATE_CENTS,
      whatsappTemplate: DEFAULT_WHATSAPP_TEMPLATE,
      hasCustomTemplate: false,
      bankName: '',
      iban: '',
      bic: '',
      isSmallBusiness: false,
    });
  });

  it('uses the stored values and marks a custom template', () => {
    const settings = toWorkshopSettings({
      companyName: ' Werkstatt Müller ',
      hourlyRateCents: 11_000,
      whatsappTemplate: 'Hallo {Kundenname}',
      bankName: 'Werkstattbank',
      iban: 'DE02120300000000202051',
      bic: 'BYLADEM1001',
      isSmallBusiness: true,
    });
    expect(settings).toEqual({
      companyName: 'Werkstatt Müller',
      hourlyRateCents: 11_000,
      whatsappTemplate: 'Hallo {Kundenname}',
      hasCustomTemplate: true,
      bankName: 'Werkstattbank',
      iban: 'DE02120300000000202051',
      bic: 'BYLADEM1001',
      isSmallBusiness: true,
    });
  });

  it('treats a blank stored template and null columns like "not set"', () => {
    const settings = toWorkshopSettings({ whatsappTemplate: '   ', bankName: null, iban: null, bic: null, hourlyRateCents: null });
    expect(settings.whatsappTemplate).toBe(DEFAULT_WHATSAPP_TEMPLATE);
    expect(settings.hasCustomTemplate).toBe(false);
    expect(settings.hourlyRateCents).toBe(DEFAULT_HOURLY_RATE_CENTS);
    expect(settings.iban).toBe('');
  });

  it('keeps an hourly rate of 0 (free of charge) instead of replacing it by the default', () => {
    expect(toWorkshopSettings({ hourlyRateCents: 0 }).hourlyRateCents).toBe(0);
  });
});
