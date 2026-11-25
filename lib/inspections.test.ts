import { describe, expect, it } from 'vitest';
import {
  JPEG_DATA_URL_PREFIX,
  MAX_IMPORT_INSPECTIONS,
  MAX_INSPECTION_NOTE_LENGTH,
  MAX_INSPECTION_PHOTO_CHARS,
  isUuid,
  parseInspectionHeader,
  parseItemChange,
  parseLegacyInspections,
  parsePhotoDataUrl,
} from './inspections';

const photo = (base64 = 'QUJD') => `${JPEG_DATA_URL_PREFIX}${base64}`;

describe('parseInspectionHeader', () => {
  it('trims, collapses spaces and writes the plate in capitals', () => {
    expect(parseInspectionHeader({ customerName: '  Anna   Müller ', vehicleLabel: 'VW  Golf', plate: ' s-wn 1234 ' })).toEqual({
      ok: true,
      value: { customerName: 'Anna Müller', vehicleLabel: 'VW Golf', plate: 'S-WN 1234' },
    });
  });
  it('allows empty fields while the form is still being filled in', () => {
    expect(parseInspectionHeader({})).toEqual({ ok: true, value: { customerName: '', vehicleLabel: '', plate: '' } });
    expect(parseInspectionHeader(null)).toMatchObject({ ok: true });
    expect(parseInspectionHeader({ plate: null })).toMatchObject({ ok: true });
  });
  it('refuses wrong types and too long values with a German message', () => {
    expect(parseInspectionHeader({ customerName: 42 })).toEqual({ ok: false, message: 'Der Kundenname ist ungültig.' });
    expect(parseInspectionHeader({ plate: 'X'.repeat(21) })).toMatchObject({ ok: false, message: expect.stringMatching(/höchstens 20/) });
    expect(parseInspectionHeader({ vehicleLabel: 'V'.repeat(201) })).toMatchObject({ ok: false });
    expect(parseInspectionHeader({ customerName: 'K'.repeat(200) })).toMatchObject({ ok: true });
  });
});

describe('parseItemChange', () => {
  it('accepts a status, a note or both', () => {
    expect(parseItemChange({ status: 'rot' })).toEqual({ ok: true, value: { status: 'rot' } });
    expect(parseItemChange({ note: 'Beläge vorn' })).toEqual({ ok: true, value: { note: 'Beläge vorn' } });
    expect(parseItemChange({ status: 'gelb', note: '' })).toEqual({ ok: true, value: { status: 'gelb', note: '' } });
  });
  it('refuses unknown status, wrong note type, too long note and empty changes', () => {
    expect(parseItemChange({ status: 'blau' })).toMatchObject({ ok: false, message: 'Der Befund ist ungültig.' });
    expect(parseItemChange({ note: 5 })).toMatchObject({ ok: false });
    expect(parseItemChange({ note: 'x'.repeat(MAX_INSPECTION_NOTE_LENGTH + 1) })).toMatchObject({ ok: false });
    expect(parseItemChange({ note: 'x'.repeat(MAX_INSPECTION_NOTE_LENGTH) })).toMatchObject({ ok: true });
    expect(parseItemChange({})).toMatchObject({ ok: false, message: 'Es wurde nichts geändert.' });
    expect(parseItemChange('status=rot')).toMatchObject({ ok: false });
  });
});

describe('parsePhotoDataUrl (the same rule as the database check)', () => {
  it('accepts a compressed JPEG data URL', () => {
    expect(parsePhotoDataUrl(photo('/9j/4AAQSkZJRgABAQ=='))).toMatchObject({ ok: true });
  });
  it('refuses other formats and anything that is no image', () => {
    for (const bad of ['data:image/png;base64,QUJD', 'javascript:alert(1)', 'https://example.com/a.jpg', '', null, 42]) {
      expect(parsePhotoDataUrl(bad)).toMatchObject({ ok: false });
    }
  });
  it('refuses broken base64 and photos above the size limit', () => {
    expect(parsePhotoDataUrl(photo('QUJD<script>'))).toMatchObject({ ok: false, message: 'Das Foto ist beschädigt.' });
    expect(parsePhotoDataUrl(photo())).toMatchObject({ ok: true });
    const atLimit = photo('A'.repeat(MAX_INSPECTION_PHOTO_CHARS - JPEG_DATA_URL_PREFIX.length));
    expect(parsePhotoDataUrl(atLimit)).toMatchObject({ ok: true });
    expect(parsePhotoDataUrl(`${atLimit}A`)).toMatchObject({ ok: false, message: expect.stringMatching(/zu groß/) });
  });
});

describe('parseLegacyInspections (moving the old browser data once)', () => {
  const legacy = (overrides: Record<string, unknown> = {}) => ({
    id: 'abc',
    customer: 'Anna Müller',
    vehicle: 'VW Golf',
    plate: 's-wn 1',
    items: [
      { id: '1', label: 'Bremsanlage', status: 'gelb', note: 'Beläge', photo: photo() },
      { id: '2', label: 'Bereifung', status: 'gruen', note: '' },
    ],
    ...overrides,
  });

  it('turns the old format into the import format and keeps photos', () => {
    const result = parseLegacyInspections([legacy()]);
    expect(result.skipped).toBe(0);
    expect(result.inspections).toEqual([
      {
        customerName: 'Anna Müller',
        vehicleLabel: 'VW Golf',
        plate: 'S-WN 1',
        items: [
          { label: 'Bremsanlage', status: 'gelb', note: 'Beläge', photo: photo() },
          { label: 'Bereifung', status: 'gruen', note: '', photo: null },
        ],
      },
    ]);
  });

  it('does not import the demo entry every browser got by default', () => {
    expect(parseLegacyInspections([legacy({ id: 'pruefung-1' })])).toEqual({ inspections: [], skipped: 0 });
  });

  it('skips broken entries but keeps the good ones', () => {
    const result = parseLegacyInspections([null, 'x', legacy({ items: 'kaputt' }), legacy({ items: [] }), legacy()]);
    expect(result.inspections).toHaveLength(1);
    expect(result.skipped).toBe(4);
  });

  it('drops photos the database would refuse, defaults unknown status to green, cuts long texts', () => {
    const [entry] = parseLegacyInspections([
      legacy({
        plate: 'P'.repeat(40),
        items: [{ label: '  Licht ', status: 'lila', note: 'n'.repeat(3000), photo: 'data:image/png;base64,AAAA' }, { label: '   ' }],
      }),
    ]).inspections;
    expect(entry?.plate).toHaveLength(20);
    expect(entry?.items).toEqual([{ label: 'Licht', status: 'gruen', note: 'n'.repeat(MAX_INSPECTION_NOTE_LENGTH), photo: null }]);
  });

  it('reads nothing from something that is not a list, and caps very long lists', () => {
    expect(parseLegacyInspections({ items: [] })).toEqual({ inspections: [], skipped: 0 });
    const many = Array.from({ length: MAX_IMPORT_INSPECTIONS + 3 }, (_, index) => legacy({ id: `x${index}` }));
    const result = parseLegacyInspections(many);
    expect(result.inspections).toHaveLength(MAX_IMPORT_INSPECTIONS);
    expect(result.skipped).toBe(3);
  });
});

describe('isUuid', () => {
  it('recognises ids', () => {
    expect(isUuid('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(true);
    expect(isUuid('pruefung-1')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
