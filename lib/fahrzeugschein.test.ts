import { describe, expect, it } from 'vitest';
import { normalizeVin, parseFahrzeugscheinText } from './fahrzeugschein';

const NOW = new Date('2026-11-19T12:00:00Z');

describe('normalizeVin', () => {
  it('accepts a valid VIN and uppercases it', () => {
    expect(normalizeVin('wvwzzz1kz8w123456')).toBe('WVWZZZ1KZ8W123456');
  });

  it('repairs O, Q and I that OCR read instead of 0, 0 and 1', () => {
    expect(normalizeVin('WVWZZZ1KZ8WI2345O')).toBe('WVWZZZ1KZ8W123450');
  });

  it('rejects the wrong length and noise made of one kind of character', () => {
    expect(normalizeVin('WVWZZZ1KZ8W12345')).toBeNull();
    expect(normalizeVin('12345678901234567')).toBeNull();
    expect(normalizeVin('ABCDEFGHJKLMNPRST')).toBeNull();
  });
});

describe('parseFahrzeugscheinText', () => {
  it('reads VIN, HSN, TSN and first registration from labelled fields', () => {
    const text = [
      'Zulassungsbescheinigung Teil I',
      'A  S-WN 1234',
      'B  12.03.2015',
      'E  WVWZZZ1KZ8W123456',
      '2.1 0603',
      '2.2 BDK',
    ].join('\n');
    expect(parseFahrzeugscheinText(text, NOW)).toEqual({
      vin: 'WVWZZZ1KZ8W123456',
      hsn: '0603',
      tsn: 'BDK',
      firstRegistration: '2015-03-12',
      year: 2015,
    });
  });

  it('reads HSN and TSN from the combined "zu 2 und 3" line', () => {
    expect(parseFahrzeugscheinText('Schlüsselnummer zu 2 und 3: 0603 / BDK', NOW)).toEqual({
      hsn: '0603',
      tsn: 'BDK',
    });
  });

  it('fixes letters OCR put into the numeric HSN', () => {
    expect(parseFahrzeugscheinText('2.1 O6O3\n2.2 BDK', NOW)).toMatchObject({ hsn: '0603', tsn: 'BDK' });
  });

  it('finds a VIN that OCR split with spaces', () => {
    expect(parseFahrzeugscheinText('E WVWZZZ 1KZ8W 123456', NOW).vin).toBe('WVWZZZ1KZ8W123456');
  });

  it('reads the date when it sits on the line after the label', () => {
    const text = 'B Datum der Erstzulassung\n03.11.2019';
    expect(parseFahrzeugscheinText(text, NOW)).toEqual({ firstRegistration: '2019-11-03', year: 2019 });
  });

  it('ignores impossible and future dates', () => {
    expect(parseFahrzeugscheinText('B 31.02.2015', NOW)).toEqual({});
    expect(parseFahrzeugscheinText('B 01.01.2030', NOW)).toEqual({});
    expect(parseFahrzeugscheinText('B 01.01.1850', NOW)).toEqual({});
  });

  it('leaves out what it cannot read and never guesses', () => {
    expect(parseFahrzeugscheinText('', NOW)).toEqual({});
    expect(parseFahrzeugscheinText('völlig unleserlicher Text 123', NOW)).toEqual({});
  });

  it('does not take a lone letter B inside a word for the date label', () => {
    expect(parseFahrzeugscheinText('ABC 12.03.2015', NOW)).toEqual({});
  });
});
