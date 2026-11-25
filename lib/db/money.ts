export interface InvoiceLineAmount {
  quantityMilli: number;
  unitNetPriceCents: number;
  taxRateBps: number;
}

export interface InvoiceTotalsCents {
  netTotalCents: number;
  taxTotalCents: number;
  grossTotalCents: number;
}

function assertSafeNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

function roundRatio(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator)) {
    throw new RangeError('The calculated amount exceeds the safe integer range.');
  }
  return Math.floor((numerator + denominator / 2) / denominator);
}

export function calculateInvoiceTotalsCents(
  lines: readonly InvoiceLineAmount[],
): InvoiceTotalsCents {
  let netTotalCents = 0;
  let taxTotalCents = 0;

  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantityMilli) || line.quantityMilli <= 0) {
      throw new RangeError('quantityMilli must be a positive safe integer.');
    }
    assertSafeNonNegativeInteger(line.unitNetPriceCents, 'unitNetPriceCents');
    if (!Number.isSafeInteger(line.taxRateBps) || line.taxRateBps < 0 || line.taxRateBps > 10_000) {
      throw new RangeError('taxRateBps must be an integer between 0 and 10000.');
    }

    const lineNetCents = roundRatio(line.quantityMilli * line.unitNetPriceCents, 1_000);
    const lineTaxCents = roundRatio(lineNetCents * line.taxRateBps, 10_000);
    netTotalCents += lineNetCents;
    taxTotalCents += lineTaxCents;

    assertSafeNonNegativeInteger(netTotalCents, 'netTotalCents');
    assertSafeNonNegativeInteger(taxTotalCents, 'taxTotalCents');
  }

  const grossTotalCents = netTotalCents + taxTotalCents;
  assertSafeNonNegativeInteger(grossTotalCents, 'grossTotalCents');
  return {
    netTotalCents,
    taxTotalCents,
    grossTotalCents,
  };
}
