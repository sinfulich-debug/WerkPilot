import { invoiceTotals } from './money';
import type { UnitCode } from './units';

export type TaxMode = 'standard19' | 'reduced7' | 'smallBusiness';

export type InvoiceLine = {
  id: string;
  description: string;
  quantity: number;
  /** Unit of the quantity; a line without one counts as pieces (C62). */
  unit?: UnitCode;
  unitPrice: number;
};

export type InvoiceLineInput = Pick<InvoiceLine, 'description' | 'quantity' | 'unitPrice' | 'unit'>;

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled';

export type InvoiceSellerSnapshot = {
  companyName: string;
  ownerName: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  taxNumber: string | null;
  vatId: string | null;
  bankName: string | null;
  iban: string | null;
  bic: string | null;
};

export type InvoiceBuyerSnapshot = {
  name: string;
  vehiclePlate: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
};

export type Invoice = {
  id: string;
  customerId: string;
  vehicleId: string | null;
  number: string | null;
  customer: string;
  plate: string;
  lines: InvoiceLine[];
  taxMode: TaxMode;
  serviceDate: string;
  dueAt: string | null;
  issuedAt: string | null;
  status: InvoiceStatus;
  paidAmount: number;
  sellerSnapshot: InvoiceSellerSnapshot;
  buyerSnapshot: InvoiceBuyerSnapshot;
  /** This document is a Storno of the invoice with this id and number. */
  cancelsInvoiceId?: string;
  cancelsNumber?: string;
  /** This invoice was cancelled by the Storno with this number. */
  cancelledByNumber?: string;
};

export type InvoiceInput = {
  customerId: string;
  vehicleId?: string;
  serviceDate: string;
  dueAt: string;
  lines: InvoiceLineInput[];
  taxMode: TaxMode;
};

export type Payment = {
  id: string;
  invoiceId: string;
  amount: number;
  paidAt: string;
};

// Kept for the read-only local report on the inventory page.
export type WorkshopInvoice = {
  id: string;
  number: string;
  customer: string;
  plate: string;
  lines: InvoiceLine[];
  taxMode: TaxMode;
  issuedAt: string;
  dueAt: string;
  status: 'offen' | 'bezahlt';
};

export const taxModes: { value: TaxMode; label: string }[] = [
  { value: 'standard19', label: '19 % Umsatzsteuer' },
  { value: 'reduced7', label: '7 % Umsatzsteuer' },
  { value: 'smallBusiness', label: '§ 19 UStG – Kleinunternehmerregelung' },
];

export function getTaxRate(mode: TaxMode): number {
  if (mode === 'standard19') return 0.19;
  if (mode === 'reduced7') return 0.07;
  return 0;
}

export function getTaxRateBps(mode: TaxMode): number {
  if (mode === 'standard19') return 1_900;
  if (mode === 'reduced7') return 700;
  return 0;
}

export function quantityToMilli(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new RangeError('Quantity must be a positive number.');
  }

  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(String(quantity));
  if (!match) throw new RangeError('Quantity must have at most three decimal places.');

  const wholePart = Number(match[1]);
  const fractionPart = Number((match[2] ?? '').padEnd(3, '0') || '0');
  const quantityMilli = wholePart * 1_000 + fractionPart;
  if (!Number.isSafeInteger(quantityMilli) || quantityMilli <= 0 || quantityMilli > 2_147_483_647) {
    throw new RangeError('Quantity exceeds the supported range.');
  }
  return quantityMilli;
}

export function euroToCents(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError('Amount must be a non-negative number.');
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount));
  if (!match) throw new RangeError('Amount must have at most two decimal places.');

  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents)) throw new RangeError('Amount exceeds the supported range.');
  if (cents > 2_147_483_647) throw new RangeError('Amount exceeds the supported range.');
  return cents;
}

/**
 * Totals of an invoice for display. A cancellation (Storno) has negative quantities and must keep them,
 * so its totals are the exact negative of the original. Lines with quantity 0 are ignored.
 */
export function getInvoiceTotals(lines: InvoiceLine[], mode: TaxMode) {
  const totals = invoiceTotals(lines.filter((line) => line.quantity !== 0).map((line) => ({
    qtyMilli: line.quantity < 0 ? -quantityToMilli(-line.quantity) : quantityToMilli(line.quantity),
    unitPriceCents: euroToCents(line.unitPrice),
    taxRateBp: getTaxRateBps(mode),
  })));
  return {
    net: totals.netCents / 100,
    tax: totals.taxCents / 100,
    gross: totals.grossCents / 100,
  };
}

export function isInvoiceList(value: unknown): value is WorkshopInvoice[] {
  return Array.isArray(value) && value.every((invoice) => {
    if (!invoice || typeof invoice !== 'object') return false;
    const item = invoice as Record<string, unknown>;
    const lines = item.lines;
    return typeof item.id === 'string' && typeof item.number === 'string' &&
      typeof item.customer === 'string' && typeof item.plate === 'string' &&
      (item.taxMode === 'standard19' || item.taxMode === 'reduced7' || item.taxMode === 'smallBusiness') &&
      typeof item.issuedAt === 'string' && typeof item.dueAt === 'string' &&
      (item.status === 'offen' || item.status === 'bezahlt') &&
      Array.isArray(lines) && lines.every((line) => {
        if (!line || typeof line !== 'object') return false;
        const row = line as Record<string, unknown>;
        return typeof row.id === 'string' && typeof row.description === 'string' &&
          typeof row.quantity === 'number' && Number.isFinite(row.quantity) && row.quantity > 0 &&
          typeof row.unitPrice === 'number' && Number.isFinite(row.unitPrice) && row.unitPrice >= 0;
      });
  });
}

export function createEpcPaymentData({
  recipient,
  iban,
  bic,
  amount,
  reference,
}: {
  recipient: string;
  iban: string;
  bic: string;
  amount: number;
  reference: string;
}): string {
  return [
    'BCD',
    '002',
    '1',
    'SCT',
    bic.replace(/\s/g, '').toUpperCase(),
    recipient.slice(0, 70),
    iban.replace(/\s/g, '').toUpperCase(),
    `EUR${amount.toFixed(2)}`,
    '',
    '',
    reference.slice(0, 140),
  ].join('\n');
}
