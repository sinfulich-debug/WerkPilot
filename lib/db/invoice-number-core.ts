export function getNextInvoiceSequenceNumber(lastNumber: number): number {
  if (!Number.isSafeInteger(lastNumber) || lastNumber < 0 || lastNumber >= 2_147_483_647) {
    throw new RangeError('lastNumber must be a non-negative PostgreSQL integer below its maximum.');
  }
  return lastNumber + 1;
}

export function formatInvoiceNumber(year: number, sequenceNumber: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new RangeError('Invoice year must be an integer between 2000 and 9999.');
  }
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 1) {
    throw new RangeError('Invoice sequence number must be a positive safe integer.');
  }
  return `RE-${year}-${String(sequenceNumber).padStart(4, '0')}`;
}
