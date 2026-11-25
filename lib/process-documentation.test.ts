import { describe, expect, it } from 'vitest';
import { formatInvoiceNumber } from './db/invoice-number-core';
import { lineNetCents } from './money';
import {
  buildProcessDocumentation,
  countOpenFields,
  getProcessFieldKeys,
  type ProcessBlock,
  type ProcessDocumentInput,
} from './process-documentation';
import { UNITS } from './units';
import { workOrderStatuses } from './work-order-status';

const input: ProcessDocumentInput = {
  companyName: 'Kfz Meier & Söhne',
  ownerName: 'Hans Meier',
  street: 'Werkstattstr. 1',
  zip: '70173',
  city: 'Stuttgart',
  phone: '0711 123456',
  email: 'info@meier.example',
  taxNumber: '12/345/67890',
  vatId: 'DE123456789',
  today: '2026-11-17',
};

const allText = (blocks: ProcessBlock[]): string =>
  blocks
    .map((block) => (block.kind === 'text' ? block.text : block.kind === 'list' ? block.items.join(' ') : `${block.label} ${block.hint ?? ''}`))
    .join(' ');

// "null" is a normal German word ("von null weg"); these are the signs of a value that leaked into the text
const LEAKED_VALUES = /\bundefined\b|\bNaN\b|\[object|:\s*null\b|,\s*null\b/;

const documentText = (document: ReturnType<typeof buildProcessDocumentation>) =>
  document.sections.map((section) => `${section.title} ${allText(section.blocks)}`).join('\n');

describe('buildProcessDocumentation', () => {
  const document = buildProcessDocumentation(input);

  it('puts the workshop and the date of this version on the cover', () => {
    expect(document.title).toBe('Verfahrensdokumentation nach GoBD');
    expect(document.version).toBe('17.11.2026');
    expect(document.cover).toEqual([
      { label: 'Betrieb', value: 'Kfz Meier & Söhne' },
      { label: 'Inhaber/in', value: 'Hans Meier' },
      { label: 'Anschrift', value: 'Werkstattstr. 1, 70173 Stuttgart' },
      { label: 'Steuernummer', value: '12/345/67890' },
      { label: 'USt-IdNr.', value: 'DE123456789' },
      { label: 'Stand dieser Fassung', value: '17.11.2026' },
    ]);
  });

  it('leaves out what the workshop has not entered, without leaking missing values into the text', () => {
    const sparse = buildProcessDocumentation({ ...input, ownerName: null, street: null, zip: null, city: null, taxNumber: '  ', vatId: null });
    expect(sparse.cover).toEqual([
      { label: 'Betrieb', value: 'Kfz Meier & Söhne' },
      { label: 'Stand dieser Fassung', value: '17.11.2026' },
    ]);
    expect(documentText(sparse)).not.toMatch(LEAKED_VALUES);
    expect(documentText(document)).not.toMatch(LEAKED_VALUES);
  });

  it('has the four parts the GoBD expect, in a sensible order, with unique ids', () => {
    const titles = document.sections.map((section) => section.title);
    expect(titles).toEqual([
      '1. Zweck und Geltungsbereich',
      '2. Organisation und Verantwortlichkeiten',
      '3. Eingesetzte Software und nicht abgebildete Vorgänge',
      '4. Anwenderdokumentation: Arbeitsabläufe',
      '5. Technische Systemdokumentation: eingebaute Kontrollen',
      '6. Betriebsdokumentation',
      '7. Interne Kontrolle (Vorschlag)',
      '8. Änderungshistorie dieser Dokumentation',
    ]);
    const ids = document.sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of document.sections) expect(section.blocks.length).toBeGreaterThan(0);
  });

  it('leaves the questions only the workshop can answer open, each with a label', () => {
    const fields = document.sections.flatMap((section) => section.blocks.filter((block) => block.kind === 'fill'));
    expect(fields.length).toBeGreaterThanOrEqual(12);
    expect(countOpenFields(document)).toBe(fields.length);
    for (const field of fields) {
      expect(field.kind === 'fill' && field.label.trim().length > 5).toBe(true);
    }
    // backups, retention, access during an audit and responsibilities are the workshop's to answer
    const text = documentText(document);
    for (const topic of ['Datensicherung', 'Aufbewahrungsfristen', 'Betriebsprüfung', 'Verantwortliche Person', 'Vertretung']) {
      expect(text).toContain(topic);
    }
  });

  it('gives every fill-in field a unique, database-safe key (the answers are stored under it)', () => {
    const keys = getProcessFieldKeys(document);
    expect(keys.length).toBe(countOpenFields(document));
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z0-9-]{1,60}$/);
    expect(keys).toContain('backup');
    expect(keys).toContain('retention');
  });

  it('says that it is a template and not tax advice', () => {
    expect(documentText(document)).toContain('ersetzt keine Steuerberatung');
  });
});

describe('statements about the system match the code', () => {
  const text = documentText(buildProcessDocumentation(input));

  it('invoice numbers: the format and the example come from the real formatter', () => {
    expect(formatInvoiceNumber(2026, 1)).toBe('RE-2026-0001');
    expect(text).toContain('RE-JJJJ-NNNN');
    expect(text).toContain(formatInvoiceNumber(2026, 1));
    expect(buildProcessDocumentation({ ...input, today: '2027-03-01' })).toBeDefined();
    expect(documentText(buildProcessDocumentation({ ...input, today: '2027-03-01' }))).toContain('RE-2027-0001');
  });

  it('units: every unit of the program is listed', () => {
    for (const unit of UNITS) expect(text).toContain(`${unit.label} (${unit.name})`);
  });

  it('work order stages: the six stages in the text are the real ones (update the text when a stage is added)', () => {
    expect([...workOrderStatuses]).toEqual(['draft', 'estimate', 'approved', 'in_progress', 'completed', 'invoiced']);
    for (const name of ['Entwurf', 'Kostenvoranschlag', 'Freigegeben', 'In Arbeit', 'Abgeschlossen', 'Rechnung erstellt']) {
      expect(text).toContain(name);
    }
  });

  it('rounding: half a cent rounds away from zero, as the text says', () => {
    expect(lineNetCents(500, 1)).toBe(1);
    expect(lineNetCents(-500, 1)).toBe(-1);
    expect(text).toContain('halbe Cent von null weg');
  });

  it('describes storno, immutability, the change log and the role rules', () => {
    for (const phrase of ['Stornorechnung', 'weder geändert noch gelöscht', 'Änderungsprotokoll', 'nicht geändert, gelöscht oder geleert', 'Row Level Security', 'Mechaniker (mechanic)']) {
      expect(text).toContain(phrase);
    }
  });

  it('is honest about what WerkPilot does not do', () => {
    for (const phrase of ['Kassenführung', 'DATEV', 'versendet aber nichts']) expect(text).toContain(phrase);
  });
});
