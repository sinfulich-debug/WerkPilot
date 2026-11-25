import { csvAmount, csvRaw, toCsv, type CsvCell } from './csv';
import { getDateStringInTimeZone, INVOICE_TIME_ZONE } from './date';
import { invoiceTotals, type InvoiceLine as MoneyLine } from './money';
import { getPaymentSummary } from './payment-status';
import type { ReportPeriod } from './report-period';

/** An issued or cancelled invoice (drafts have no place in the journal) with everything the report needs. */
export type JournalInvoice = {
  id: string;
  number: string;
  /** ISO timestamp of issuing. */
  issuedAt: string;
  serviceDate: string | null;
  /** Buyer name as it stands on the invoice (the snapshot), not today's customer record. */
  customer: string;
  status: 'issued' | 'cancelled';
  /** Set on a Storno: number of the invoice it cancels. */
  cancelsNumber?: string;
  /** Set on a cancelled invoice: number of the Storno that cancelled it. */
  cancelledByNumber?: string;
  dueDate: string | null;
  lines: MoneyLine[];
  paidCents: number;
};

export type TaxGroupAmounts = { taxRateBp: number; netCents: number; taxCents: number };

export type JournalRow = {
  id: string;
  number: string;
  issueDate: string;
  serviceDate: string | null;
  customer: string;
  kind: 'Rechnung' | 'Stornorechnung';
  /** The other document of a cancelled pair, e.g. "storniert durch RE-2026-0002". */
  reference: string;
  groups: TaxGroupAmounts[];
  netCents: number;
  taxCents: number;
  grossCents: number;
  paidCents: number;
  openCents: number;
  statusLabel: string;
};

const STATUS_LABEL = {
  draft: 'Entwurf',
  open: 'Offen',
  partial: 'Teilbezahlt',
  paid: 'Bezahlt',
  cancelled: 'Storniert',
  storno: 'Stornorechnung',
} as const;

/**
 * The invoice journal for a period: every issued invoice and every Storno document whose issue date
 * (a calendar day in Europe/Berlin) lies in the period, ordered by number.
 */
export function buildJournal(invoices: readonly JournalInvoice[], period: ReportPeriod, today: string): JournalRow[] {
  const rows: JournalRow[] = [];

  for (const invoice of invoices) {
    const issueDate = getDateStringInTimeZone(new Date(invoice.issuedAt), INVOICE_TIME_ZONE);
    if (issueDate < period.from || issueDate > period.to) continue;

    const totals = invoiceTotals(invoice.lines);
    const isStorno = invoice.cancelsNumber !== undefined;
    const summary = getPaymentSummary({
      status: invoice.status,
      cancelsInvoiceId: isStorno ? invoice.cancelsNumber : undefined,
      grossCents: totals.grossCents,
      paidCents: invoice.paidCents,
      dueDate: invoice.dueDate,
      today,
    });

    rows.push({
      id: invoice.id,
      number: invoice.number,
      issueDate,
      serviceDate: invoice.serviceDate,
      customer: invoice.customer,
      kind: isStorno ? 'Stornorechnung' : 'Rechnung',
      reference: isStorno
        ? `storniert ${invoice.cancelsNumber}`
        : invoice.cancelledByNumber
          ? `storniert durch ${invoice.cancelledByNumber}`
          : '',
      groups: totals.groups.map(({ taxRateBp, netCents, taxCents }) => ({ taxRateBp, netCents, taxCents })),
      netCents: totals.netCents,
      taxCents: totals.taxCents,
      grossCents: totals.grossCents,
      paidCents: invoice.paidCents,
      openCents: summary.openCents,
      statusLabel: STATUS_LABEL[summary.kind],
    });
  }

  return rows.sort((a, b) => a.number.localeCompare(b.number, 'de', { numeric: true }));
}

export type VatSummary = {
  groups: Array<TaxGroupAmounts & { grossCents: number }>;
  netCents: number;
  taxCents: number;
  grossCents: number;
  paidCents: number;
  openCents: number;
};

/**
 * Turnover and VAT per tax rate for the journal rows. Storno documents count negative, so a cancelled
 * invoice and its Storno cancel out. Rates are listed from high to low (19 %, 7 %, 0 %).
 */
export function summarizeVat(rows: readonly JournalRow[]): VatSummary {
  const byRate = new Map<number, TaxGroupAmounts>();
  for (const row of rows) {
    for (const group of row.groups) {
      const sum = byRate.get(group.taxRateBp) ?? { taxRateBp: group.taxRateBp, netCents: 0, taxCents: 0 };
      sum.netCents += group.netCents;
      sum.taxCents += group.taxCents;
      byRate.set(group.taxRateBp, sum);
    }
  }
  const groups = Array.from(byRate.values())
    .sort((a, b) => b.taxRateBp - a.taxRateBp)
    .map((group) => ({ ...group, grossCents: group.netCents + group.taxCents }));

  return {
    groups,
    netCents: rows.reduce((sum, row) => sum + row.netCents, 0),
    taxCents: rows.reduce((sum, row) => sum + row.taxCents, 0),
    grossCents: rows.reduce((sum, row) => sum + row.grossCents, 0),
    paidCents: rows.reduce((sum, row) => sum + row.paidCents, 0),
    openCents: rows.reduce((sum, row) => sum + row.openCents, 0),
  };
}

/** "19 %", "7 %", "7,5 %". */
export function formatTaxRate(taxRateBp: number): string {
  return `${String(taxRateBp / 100).replace('.', ',')} %`;
}

function formatDate(date: string | null): string {
  return date ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}` : '';
}

/** Tax rates that get their own columns: always 19, 7 and 0 %, plus any other rate that occurs. */
function csvRates(rows: readonly JournalRow[]): number[] {
  const rates = new Set<number>([1_900, 700, 0]);
  for (const row of rows) for (const group of row.groups) rates.add(group.taxRateBp);
  return Array.from(rates).sort((a, b) => b - a);
}

/** The journal as a CSV file for the tax advisor, with a sum row at the end. */
export function journalToCsv(rows: readonly JournalRow[]): string {
  const rates = csvRates(rows);
  const summary = summarizeVat(rows);
  const amount = (cents: number): CsvCell => csvRaw(csvAmount(cents));

  const header: CsvCell[] = [
    'Rechnungsnummer',
    'Rechnungsdatum',
    'Leistungsdatum',
    'Kunde',
    'Art',
    'Bezug',
    ...rates.flatMap((rate) => [`Netto ${formatTaxRate(rate)}`, `USt ${formatTaxRate(rate)}`]),
    'Brutto',
    'Bezahlt',
    'Offen',
    'Status',
  ];

  const amountsByRate = (groups: readonly TaxGroupAmounts[]): CsvCell[] =>
    rates.flatMap((rate) => {
      const group = groups.find((item) => item.taxRateBp === rate);
      return [amount(group?.netCents ?? 0), amount(group?.taxCents ?? 0)];
    });

  const body: CsvCell[][] = rows.map((row) => [
    row.number,
    csvRaw(formatDate(row.issueDate)),
    csvRaw(formatDate(row.serviceDate)),
    row.customer,
    row.kind,
    row.reference,
    ...amountsByRate(row.groups),
    amount(row.grossCents),
    amount(row.paidCents),
    amount(row.openCents),
    row.statusLabel,
  ]);

  const total: CsvCell[] = [
    'Summe',
    '',
    '',
    '',
    '',
    '',
    ...amountsByRate(summary.groups),
    amount(summary.grossCents),
    amount(summary.paidCents),
    amount(summary.openCents),
    '',
  ];

  return toCsv([header, ...body, total]);
}
