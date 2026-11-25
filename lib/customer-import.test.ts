import { describe, expect, it } from 'vitest';
import {
  buildImportPreview,
  buildImportRow,
  customerKey,
  decodeCsvBytes,
  detectSeparator,
  guessMapping,
  MAX_IMPORT_ROWS,
  parseCsv,
  parseImportDate,
  parseImportYear,
  parseMapping,
  planImport,
  plateKey,
} from './customer-import';

describe('decodeCsvBytes', () => {
  it('reads UTF-8 and falls back to Windows-1252 for old Excel files', () => {
    expect(decodeCsvBytes(new TextEncoder().encode('Müller'))).toBe('Müller');
    expect(decodeCsvBytes(new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]))).toBe('Müller');
  });
});

describe('parseCsv', () => {
  it('reads German Excel files with BOM, semicolons and CRLF', () => {
    expect(parseCsv('﻿Name;Telefon\r\nMüller;0171 1\r\n')).toEqual([
      ['Name', 'Telefon'],
      ['Müller', '0171 1'],
    ]);
  });

  it('handles quotes, doubled quotes, separators and line breaks inside cells', () => {
    expect(parseCsv('a;b\n"x;y";"say ""hi"""\n"line\nbreak";z', ';')).toEqual([
      ['a', 'b'],
      ['x;y', 'say "hi"'],
      ['line\nbreak', 'z'],
    ]);
  });

  it('skips empty lines and keeps empty cells', () => {
    expect(parseCsv('a;b\n\n;2\n;;\n', ';')).toEqual([
      ['a', 'b'],
      ['', '2'],
    ]);
  });

  it('detects comma and tab separators', () => {
    expect(detectSeparator('Name,Telefon,E-Mail\n')).toBe(',');
    expect(detectSeparator('Name\tTelefon\n')).toBe('\t');
    expect(detectSeparator('"Name, Firma";Telefon\n')).toBe(';');
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('guessMapping', () => {
  it('maps common German and English headers', () => {
    expect(
      guessMapping(['Vorname', 'Nachname', 'Tel.', 'E-Mail', 'Straße', 'PLZ', 'Ort', 'Kennzeichen', 'Hersteller', 'FIN', 'TÜV fällig']),
    ).toEqual({
      firstName: 0,
      lastName: 1,
      phone: 2,
      email: 3,
      street: 4,
      zip: 5,
      city: 6,
      plate: 7,
      make: 8,
      vin: 9,
      huDueDate: 10,
    });
  });

  it('leaves unknown columns unmapped', () => {
    expect(guessMapping(['Kundennummer', 'Name'])).toEqual({ name: 1 });
  });
});

describe('parseMapping', () => {
  it('accepts valid mappings and drops nulls', () => {
    expect(parseMapping({ name: 0, phone: null }, 2)).toEqual({ name: 0 });
  });

  it('rejects unknown fields and out-of-range columns', () => {
    expect(parseMapping({ password: 0 }, 2)).toBeNull();
    expect(parseMapping({ name: 5 }, 2)).toBeNull();
    expect(parseMapping({ name: 1.5 }, 2)).toBeNull();
    expect(parseMapping([0], 2)).toBeNull();
  });
});

describe('parseImportDate', () => {
  it('reads full dates', () => {
    expect(parseImportDate('31.12.2026')).toBe('2026-12-31');
    expect(parseImportDate('1.3.27')).toBe('2027-03-01');
    expect(parseImportDate('2026-02-28')).toBe('2026-02-28');
  });

  it('reads HU sticker months as the last day of the month', () => {
    expect(parseImportDate('02/2028')).toBe('2028-02-29');
    expect(parseImportDate('11.2026')).toBe('2026-11-30');
    expect(parseImportDate('4/27')).toBe('2027-04-30');
  });

  it('rejects impossible or unknown dates', () => {
    expect(parseImportDate('31.02.2026')).toBeNull();
    expect(parseImportDate('13/2026')).toBeNull();
    expect(parseImportDate('demnächst')).toBeNull();
    expect(parseImportDate('')).toBeNull();
  });
});

describe('small helpers', () => {
  it('reads the year from several formats', () => {
    expect(parseImportYear('2014')).toBe(2014);
    expect(parseImportYear('03.2014')).toBe(2014);
    expect(parseImportYear('15.03.2014')).toBe(2014);
    expect(parseImportYear('alt')).toBeNull();
  });

  it('compares plates without spaces and dashes', () => {
    expect(plateKey('M-AB 123')).toBe(plateKey('m ab123'));
  });

  it('identifies customers by e-mail, otherwise by name and phone', () => {
    expect(customerKey({ name: 'A', email: 'X@Y.de' })).toBe(customerKey({ name: 'B', email: 'x@y.de ' }));
    expect(customerKey({ name: 'Max  Müller', phone: '0171 / 123' })).toBe(customerKey({ name: 'max müller', phone: '0171123' }));
    expect(customerKey({ name: 'Max Müller', phone: '1' })).not.toBe(customerKey({ name: 'Max Müller', phone: '2' }));
  });
});

describe('buildImportRow', () => {
  const mapping = guessMapping(['Vorname', 'Nachname', 'E-Mail', 'Kennzeichen', 'Marke', 'HU', 'FIN', 'HSN', 'Baujahr']);

  it('builds a customer with a vehicle', () => {
    const row = buildImportRow(['Max', 'Müller', 'max@x.de', 'M-AB 123', 'VW', '05/2027', 'wvwzzz1jz3w386752', '0603', '2015'], mapping, 2);
    expect(row.errors).toEqual([]);
    expect(row.warnings).toEqual([]);
    expect(row.customer?.name).toBe('Max Müller');
    expect(row.vehicle).toEqual({
      plate: 'M-AB 123',
      make: 'VW',
      model: '',
      vin: 'WVWZZZ1JZ3W386752',
      hsn: '0603',
      tsn: null,
      year: 2015,
      huDueDate: '2027-05-31',
    });
  });

  it('skips the whole row without a name or with a broken e-mail', () => {
    expect(buildImportRow(['', '', 'a@b.de', '', '', '', '', '', ''], mapping, 3).customer).toBeNull();
    const row = buildImportRow(['Max', 'M', 'kein-at', '', '', '', '', '', ''], mapping, 4);
    expect(row.customer).toBeNull();
    expect(row.errors[0]).toContain('E-Mail');
  });

  it('keeps the customer but not a vehicle without HU date', () => {
    const row = buildImportRow(['Max', 'M', '', 'M-AB 1', 'VW', '', '', '', ''], mapping, 5);
    expect(row.customer).not.toBeNull();
    expect(row.vehicle).toBeNull();
    expect(row.warnings[0]).toContain('HU-Datum fehlt');
  });

  it('drops invalid optional vehicle data with a warning', () => {
    const row = buildImportRow(['Max', 'M', '', 'M-AB 1', 'VW', '2027-01-31', 'kurz', '12', 'alt'], mapping, 6);
    expect(row.vehicle?.vin).toBeNull();
    expect(row.vehicle?.hsn).toBeNull();
    expect(row.vehicle?.year).toBeNull();
    expect(row.warnings).toHaveLength(3);
  });

  it('warns about vehicle data without a plate', () => {
    const row = buildImportRow(['Max', 'M', '', '', 'VW', '', '', '', ''], mapping, 7);
    expect(row.vehicle).toBeNull();
    expect(row.warnings[0]).toContain('ohne Kennzeichen');
  });
});

describe('buildImportPreview', () => {
  it('guesses the mapping and numbers lines like Excel', () => {
    const preview = buildImportPreview('Name;Telefon\nA;1\nB;2\n');
    expect(preview.error).toBeNull();
    expect(preview.mapping).toEqual({ name: 0, phone: 1 });
    expect(preview.rows.map((row) => row.line)).toEqual([2, 3]);
  });

  it('needs a name column', () => {
    expect(buildImportPreview('Telefon\n1').error).toContain('Namen');
  });

  it('refuses too many rows', () => {
    const text = `Name\n${'A\n'.repeat(MAX_IMPORT_ROWS + 1)}`;
    expect(buildImportPreview(text).error).toContain(String(MAX_IMPORT_ROWS));
  });

  it('reports an empty file', () => {
    expect(buildImportPreview('').error).toBe('Die Datei ist leer.');
  });
});

describe('planImport', () => {
  const text = [
    'Name;E-Mail;Telefon;Kennzeichen;Marke;HU',
    'Max Müller;max@x.de;;M-AB 1;VW;05/2027',
    'Max Müller;MAX@x.de;;M-AB 2;BMW;06/2027',
    'Eva Schmidt;;0171;M AB 1;Audi;07/2027',
    'Neu;;;B-XY 9;Opel;08/2027',
    ';;;;;',
    'Kaputt;nope;;;;',
  ].join('\n');

  it('groups vehicles per customer, matches existing customers and skips known plates', () => {
    const { rows } = buildImportPreview(text);
    const plan = planImport(rows, {
      customers: [{ id: 'c1', name: 'Eva Schmidt', email: null, phone: '0171' }],
      plates: ['B XY-9'],
    });

    expect(plan.newCustomers).toBe(2);
    expect(plan.existingCustomers).toBe(1);
    expect(plan.newVehicles).toBe(2);
    expect(plan.skippedVehicles).toBe(2);
    expect(plan.invalidRows).toBe(1);
    expect(plan.customers[0].vehicles.map((vehicle) => vehicle.plate)).toEqual(['M-AB 1', 'M-AB 2']);
    expect(plan.customers[1]).toMatchObject({ existingId: 'c1', vehicles: [] });
  });
});
