/**
 * CSV the way German Excel opens it: semicolon as separator, decimal comma, UTF-8 with BOM, CRLF lines.
 */

const BOM = '﻿';
const SEPARATOR = ';';
const LINE_BREAK = '\r\n';

/** Cell values that spreadsheet programs would read as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * A text cell. Text that starts like a formula gets an apostrophe in front, so a customer called
 * "=HYPERLINK(...)" cannot run anything when the file is opened (CSV injection).
 * Quotes are doubled and the cell is quoted when it contains the separator, a quote or a line break.
 */
export function csvText(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** An amount in cents as "1234,56" (no thousands separator, so it stays one number in Excel). */
export function csvAmount(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError('cents must be a safe integer.');
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const euros = Math.floor(absolute / 100);
  const rest = String(absolute % 100).padStart(2, '0');
  return `${sign}${euros},${rest}`;
}

/** A cell that is already formatted (numbers, dates) and must not be touched. */
export type CsvCell = { raw: string } | string;

export const csvRaw = (value: string): CsvCell => ({ raw: value });

/** Builds the whole file. Plain strings are text cells, `csvRaw(...)` cells are written as they are. */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  const lines = rows.map((row) =>
    row.map((cell) => (typeof cell === 'string' ? csvText(cell) : cell.raw)).join(SEPARATOR),
  );
  return BOM + lines.join(LINE_BREAK) + LINE_BREAK;
}
