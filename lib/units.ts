/**
 * Quantity units of an invoice line. The codes are UN/ECE Recommendation 20 codes, which the e-invoice
 * format (EN 16931) requires; the labels are what a German workshop writes on an invoice.
 */
export const UNITS = [
  { code: 'C62', label: 'Stk.', name: 'Stück' },
  { code: 'HUR', label: 'Std.', name: 'Stunde' },
  { code: 'LS', label: 'pauschal', name: 'Pauschale' },
  { code: 'SET', label: 'Satz', name: 'Satz' },
  { code: 'LTR', label: 'l', name: 'Liter' },
  { code: 'KGM', label: 'kg', name: 'Kilogramm' },
  { code: 'MTR', label: 'm', name: 'Meter' },
] as const;

export type UnitCode = (typeof UNITS)[number]['code'];

/** Unit used when none is given: one piece. */
export const DEFAULT_UNIT: UnitCode = 'C62';

export const UNIT_CODES: readonly UnitCode[] = UNITS.map((unit) => unit.code);

export function isUnitCode(value: unknown): value is UnitCode {
  return typeof value === 'string' && (UNIT_CODES as readonly string[]).includes(value);
}

/** Short label for an invoice, e.g. "Std."; an unknown code falls back to the piece label. */
export function unitLabel(code: string | null | undefined): string {
  return UNITS.find((unit) => unit.code === code)?.label ?? UNITS[0].label;
}

/** Unit of a work order line when it becomes an invoice line: labor is billed in hours, parts by the piece. */
export function unitForWorkOrderLine(kind: 'labor' | 'part'): UnitCode {
  return kind === 'labor' ? 'HUR' : 'C62';
}
