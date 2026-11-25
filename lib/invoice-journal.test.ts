import { describe, expect, it } from 'vitest';
import { buildCancellationLines } from './invoice-cancellation';
import { buildJournal, formatTaxRate, journalToCsv, summarizeVat, type JournalInvoice } from './invoice-journal';

const november = { from: '2026-11-01', to: '2026-11-30' };
const today = '2026-11-20';

function invoice(overrides: Partial<JournalInvoice> & Pick<JournalInvoice, 'number' | 'issuedAt'>): JournalInvoice {
  return {
    id: overrides.number,
    serviceDate: '2026-11-10',
    customer: 'Anna Müller',
    status: 'issued',
    dueDate: '2026-12-01',
    lines: [{ qtyMilli: 1_000, unitPriceCents: 10_000, taxRateBp: 1_900 }],
    paidCents: 0,
    ...overrides,
  };
}

describe('buildJournal', () => {
  it('keeps only invoices issued inside the period, judged by the Berlin calendar day', () => {
    const rows = buildJournal(
      [
        invoice({ number: 'RE-2026-0001', issuedAt: '2026-10-31T22:30:00.000Z' }), // 31.10. 23:30 Berlin -> October
        invoice({ number: 'RE-2026-0002', issuedAt: '2026-10-31T23:30:00.000Z' }), // 01.11. 00:30 Berlin -> November
        invoice({ number: 'RE-2026-0003', issuedAt: '2026-11-15T10:00:00.000Z' }),
        invoice({ number: 'RE-2026-0004', issuedAt: '2026-11-30T22:30:00.000Z' }), // 30.11. 23:30 Berlin -> November
        invoice({ number: 'RE-2026-0005', issuedAt: '2026-11-30T23:30:00.000Z' }), // 01.12. 00:30 Berlin -> December
      ],
      november,
      today,
    );
    expect(rows.map((row) => row.number)).toEqual(['RE-2026-0002', 'RE-2026-0003', 'RE-2026-0004']);
    expect(rows[0].issueDate).toBe('2026-11-01');
  });

  it('orders by invoice number, also past 9999', () => {
    const rows = buildJournal(
      [
        invoice({ number: 'RE-2026-10000', issuedAt: '2026-11-03T10:00:00Z' }),
        invoice({ number: 'RE-2026-9999', issuedAt: '2026-11-02T10:00:00Z' }),
        invoice({ number: 'RE-2026-0002', issuedAt: '2026-11-04T10:00:00Z' }),
      ],
      november,
      today,
    );
    expect(rows.map((row) => row.number)).toEqual(['RE-2026-0002', 'RE-2026-9999', 'RE-2026-10000']);
  });

  it('calculates net, tax and gross per tax rate from the lines', () => {
    const [row] = buildJournal(
      [
        invoice({
          number: 'RE-2026-0001',
          issuedAt: '2026-11-03T10:00:00Z',
          lines: [
            { qtyMilli: 1_000, unitPriceCents: 10_000, taxRateBp: 1_900 },
            { qtyMilli: 2_000, unitPriceCents: 5_000, taxRateBp: 700 },
          ],
        }),
      ],
      november,
      today,
    );
    expect(row.groups).toEqual([
      { taxRateBp: 700, netCents: 10_000, taxCents: 700 },
      { taxRateBp: 1_900, netCents: 10_000, taxCents: 1_900 },
    ]);
    expect(row.netCents).toBe(20_000);
    expect(row.taxCents).toBe(2_600);
    expect(row.grossCents).toBe(22_600);
  });

  it('labels each state and keeps the open amount', () => {
    const rows = buildJournal(
      [
        invoice({ number: 'RE-2026-0001', issuedAt: '2026-11-03T10:00:00Z' }),
        invoice({ number: 'RE-2026-0002', issuedAt: '2026-11-03T10:00:00Z', paidCents: 4_000 }),
        invoice({ number: 'RE-2026-0003', issuedAt: '2026-11-03T10:00:00Z', paidCents: 11_900 }),
        invoice({ number: 'RE-2026-0004', issuedAt: '2026-11-03T10:00:00Z', status: 'cancelled', cancelledByNumber: 'RE-2026-0005', paidCents: 0 }),
        invoice({ number: 'RE-2026-0005', issuedAt: '2026-11-04T10:00:00Z', cancelsNumber: 'RE-2026-0004', lines: buildCancellationLines([{ description: 'x', qtyMilli: 1_000, unitPriceCents: 10_000, taxRateBp: 1_900 }]) }),
      ],
      november,
      today,
    );
    expect(rows.map((row) => [row.statusLabel, row.openCents])).toEqual([
      ['Offen', 11_900],
      ['Teilbezahlt', 7_900],
      ['Bezahlt', 0],
      ['Storniert', 0],
      ['Stornorechnung', 0],
    ]);
    expect(rows[3].reference).toBe('storniert durch RE-2026-0005');
    expect(rows[4].reference).toBe('storniert RE-2026-0004');
    expect(rows[4].kind).toBe('Stornorechnung');
  });
});

describe('summarizeVat', () => {
  const lines19 = [{ description: 'x', qtyMilli: 1_000, unitPriceCents: 10_000, taxRateBp: 1_900 }];

  it('adds up turnover and tax per rate, highest rate first', () => {
    const rows = buildJournal(
      [
        invoice({ number: 'RE-2026-0001', issuedAt: '2026-11-03T10:00:00Z' }),
        invoice({ number: 'RE-2026-0002', issuedAt: '2026-11-04T10:00:00Z', lines: [{ qtyMilli: 3_000, unitPriceCents: 3_333, taxRateBp: 700 }] }),
        invoice({ number: 'RE-2026-0003', issuedAt: '2026-11-05T10:00:00Z', lines: [{ qtyMilli: 1_000, unitPriceCents: 7_777, taxRateBp: 0 }] }),
      ],
      november,
      today,
    );
    const summary = summarizeVat(rows);
    expect(summary.groups.map((group) => group.taxRateBp)).toEqual([1_900, 700, 0]);
    expect(summary.groups[0]).toMatchObject({ netCents: 10_000, taxCents: 1_900, grossCents: 11_900 });
    expect(summary.groups[1]).toMatchObject({ netCents: 9_999, taxCents: 700 });
    expect(summary.netCents).toBe(10_000 + 9_999 + 7_777);
    expect(summary.grossCents).toBe(summary.netCents + summary.taxCents);
  });

  it('lets a cancelled invoice and its Storno cancel out exactly', () => {
    const rows = buildJournal(
      [
        invoice({ number: 'RE-2026-0001', issuedAt: '2026-11-03T10:00:00Z', status: 'cancelled', cancelledByNumber: 'RE-2026-0002' }),
        invoice({ number: 'RE-2026-0002', issuedAt: '2026-11-04T10:00:00Z', cancelsNumber: 'RE-2026-0001', lines: buildCancellationLines(lines19) }),
        invoice({ number: 'RE-2026-0003', issuedAt: '2026-11-05T10:00:00Z' }),
      ],
      november,
      today,
    );
    const summary = summarizeVat(rows);
    // only the third invoice is left
    expect(summary.groups).toEqual([{ taxRateBp: 1_900, netCents: 10_000, taxCents: 1_900, grossCents: 11_900 }]);
    expect(summary.grossCents).toBe(11_900);
    expect(summary.openCents).toBe(11_900);
  });

  it('is empty for an empty journal', () => {
    expect(summarizeVat([])).toEqual({ groups: [], netCents: 0, taxCents: 0, grossCents: 0, paidCents: 0, openCents: 0 });
  });
});

describe('journalToCsv', () => {
  const rows = buildJournal(
    [
      invoice({ number: 'RE-2026-0001', issuedAt: '2026-11-03T10:00:00Z', customer: 'Müller; Anna', paidCents: 11_900 }),
      invoice({ number: 'RE-2026-0002', issuedAt: '2026-11-04T10:00:00Z', customer: '=HYPERLINK("http://x")', status: 'cancelled', cancelledByNumber: 'RE-2026-0003' }),
      invoice({ number: 'RE-2026-0003', issuedAt: '2026-11-05T10:00:00Z', cancelsNumber: 'RE-2026-0002', lines: buildCancellationLines([{ description: 'x', qtyMilli: 1_000, unitPriceCents: 10_000, taxRateBp: 1_900 }]) }),
    ],
    november,
    today,
  );
  const lines = journalToCsv(rows).slice(1).split('\r\n');

  it('has a header with a net and a tax column for 19, 7 and 0 percent', () => {
    expect(lines[0]).toBe(
      'Rechnungsnummer;Rechnungsdatum;Leistungsdatum;Kunde;Art;Bezug;Netto 19 %;USt 19 %;Netto 7 %;USt 7 %;Netto 0 %;USt 0 %;Brutto;Bezahlt;Offen;Status',
    );
  });

  it('writes dates as dd.mm.yyyy and amounts with a decimal comma', () => {
    expect(lines[1]).toBe('RE-2026-0001;03.11.2026;10.11.2026;"Müller; Anna";Rechnung;;100,00;19,00;0,00;0,00;0,00;0,00;119,00;119,00;0,00;Bezahlt');
  });

  it('writes the Storno with negative amounts and a reference', () => {
    expect(lines[3]).toBe("RE-2026-0003;05.11.2026;10.11.2026;Anna Müller;Stornorechnung;storniert RE-2026-0002;-100,00;-19,00;0,00;0,00;0,00;0,00;-119,00;0,00;0,00;Stornorechnung");
  });

  it('defuses a customer name that looks like a formula', () => {
    expect(lines[2].split(';')[3]).toContain("'=HYPERLINK");
  });

  it('ends with a sum row where invoice and Storno cancel out', () => {
    expect(lines[4]).toBe('Summe;;;;;;100,00;19,00;0,00;0,00;0,00;0,00;119,00;119,00;0,00;');
    expect(lines[5]).toBe(''); // file ends with a line break
  });

  it('writes an empty period as header plus zero sums', () => {
    const empty = journalToCsv([]).slice(1).split('\r\n');
    expect(empty).toHaveLength(3);
    expect(empty[1]).toBe('Summe;;;;;;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;0,00;');
  });
});

describe('formatTaxRate', () => {
  it('formats rates the German way', () => {
    expect(formatTaxRate(1_900)).toBe('19 %');
    expect(formatTaxRate(700)).toBe('7 %');
    expect(formatTaxRate(0)).toBe('0 %');
    expect(formatTaxRate(750)).toBe('7,5 %');
  });
});
