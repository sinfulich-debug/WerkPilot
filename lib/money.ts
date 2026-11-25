export type Cents = number;
export type QtyMilli = number;
export type TaxRateBp = number;

export interface InvoiceLine {
  qtyMilli: QtyMilli;
  unitPriceCents: Cents;
  taxRateBp: TaxRateBp;
}

export interface InvoiceTaxGroup {
  taxRateBp: TaxRateBp;
  netCents: Cents;
  taxCents: Cents;
}

export interface InvoiceTotals {
  groups: InvoiceTaxGroup[];
  netCents: Cents;
  taxCents: Cents;
  grossCents: Cents;
}

export interface WorkOrderMoneyLine extends InvoiceLine {
  kind: 'labor' | 'part';
  discountBp: number;
  purchasePriceCents?: Cents | null;
}

export interface WorkOrderTotals {
  labor: InvoiceTotals;
  part: InvoiceTotals;
  total: InvoiceTotals;
  marginCents: Cents;
}

const euroFormatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
});

function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer.`);
  }
}

function roundedProductRatioHalfAwayFromZero(
  left: number,
  right: number,
  divisor: number,
  resultName: string,
): number {
  assertSafeInteger(left, 'left operand');
  assertSafeInteger(right, 'right operand');
  assertSafeInteger(divisor, 'divisor');
  if (divisor <= 0) throw new RangeError('divisor must be positive.');

  const numerator = BigInt(left) * BigInt(right);
  const denominator = BigInt(divisor);
  const magnitude = numerator < 0 ? -numerator : numerator;
  const roundedMagnitude = (magnitude + denominator / BigInt(2)) / denominator;
  const rounded = Number(numerator < 0 ? -roundedMagnitude : roundedMagnitude);
  assertSafeInteger(rounded, resultName);
  return rounded === 0 ? 0 : rounded;
}

export function lineNetCents(qtyMilli: QtyMilli, unitPriceCents: Cents): Cents {
  assertSafeInteger(qtyMilli, 'qtyMilli');
  assertSafeInteger(unitPriceCents, 'unitPriceCents');

  return roundedProductRatioHalfAwayFromZero(
    qtyMilli,
    unitPriceCents,
    1_000,
    'line net cents',
  );
}

export function discountedUnitPriceCents(unitPriceCents: Cents, discountBp: number): Cents {
  assertSafeInteger(unitPriceCents, 'unitPriceCents');
  assertSafeInteger(discountBp, 'discountBp');
  if (discountBp < 0 || discountBp > 10_000) {
    throw new RangeError('discountBp must be between 0 and 10000.');
  }

  return roundedProductRatioHalfAwayFromZero(
    unitPriceCents,
    10_000 - discountBp,
    10_000,
    'discounted unit price cents',
  );
}

export function invoiceTotals(lines: readonly InvoiceLine[]): InvoiceTotals {
  const netByRate = new Map<TaxRateBp, Cents>();

  for (const line of lines) {
    assertSafeInteger(line.taxRateBp, 'taxRateBp');
    if (line.taxRateBp < 0 || line.taxRateBp > 10_000) {
      throw new RangeError('taxRateBp must be between 0 and 10000.');
    }

    const netCents = lineNetCents(line.qtyMilli, line.unitPriceCents);
    const groupNetCents = (netByRate.get(line.taxRateBp) ?? 0) + netCents;
    assertSafeInteger(groupNetCents, 'group net cents');
    netByRate.set(line.taxRateBp, groupNetCents);
  }

  const groups = Array.from(netByRate, ([taxRateBp, netCents]) => {
    const taxCents = roundedProductRatioHalfAwayFromZero(
      netCents,
      taxRateBp,
      10_000,
      'group tax cents',
    );
    return { taxRateBp, netCents, taxCents };
  }).sort((left, right) => left.taxRateBp - right.taxRateBp);

  const netCents = groups.reduce((sum, group) => sum + group.netCents, 0);
  const taxCents = groups.reduce((sum, group) => sum + group.taxCents, 0);
  const grossCents = netCents + taxCents;
  assertSafeInteger(netCents, 'invoice net cents');
  assertSafeInteger(taxCents, 'invoice tax cents');
  assertSafeInteger(grossCents, 'invoice gross cents');

  return { groups, netCents, taxCents, grossCents };
}

export function workOrderLineMarginCents(line: WorkOrderMoneyLine): Cents | null {
  if (line.kind !== 'part' || line.purchasePriceCents == null) return null;
  assertSafeInteger(line.purchasePriceCents, 'purchasePriceCents');
  if (line.purchasePriceCents < 0) throw new RangeError('purchasePriceCents must not be negative.');
  return lineNetCents(line.qtyMilli, discountedUnitPriceCents(line.unitPriceCents, line.discountBp)) -
    lineNetCents(line.qtyMilli, line.purchasePriceCents);
}

export function workOrderTotals(lines: readonly WorkOrderMoneyLine[]): WorkOrderTotals {
  const discountedLines = lines.map((line) => ({
    qtyMilli: line.qtyMilli,
    unitPriceCents: discountedUnitPriceCents(line.unitPriceCents, line.discountBp),
    taxRateBp: line.taxRateBp,
  }));
  const laborLines = lines.flatMap((line, index) => line.kind === 'labor' ? [discountedLines[index]] : []);
  const partLines = lines.flatMap((line, index) => line.kind === 'part' ? [discountedLines[index]] : []);
  const marginCents = lines.reduce((sum, line) => {
    return sum + (workOrderLineMarginCents(line) ?? 0);
  }, 0);
  assertSafeInteger(marginCents, 'work-order margin cents');

  return {
    labor: invoiceTotals(laborLines),
    part: invoiceTotals(partLines),
    total: invoiceTotals(discountedLines),
    marginCents,
  };
}

export function formatEuro(cents: Cents): string {
  assertSafeInteger(cents, 'cents');
  return euroFormatter.format(cents / 100);
}

export function parseEuroToCents(input: string): Cents {
  const value = input.trim();
  const germanAmount = /^([+-]?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(value);
  const dotDecimalAmount = /^([+-]?)(\d+)\.(\d{1,2})$/.exec(value);
  const match = germanAmount ?? dotDecimalAmount;
  if (!match) throw new RangeError('Invalid euro amount.');

  const [, sign, wholePart, decimalPart = ''] = match;
  const wholeDigits = wholePart.replace(/\./g, '');
  const centsDigits = `${wholeDigits}${decimalPart.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  const absoluteCents = Number(centsDigits);
  assertSafeInteger(absoluteCents, 'parsed cents');

  if (sign === '-' && absoluteCents !== 0) return -absoluteCents;
  return absoluteCents;
}
