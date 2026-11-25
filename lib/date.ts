export const INVOICE_TIME_ZONE = 'Europe/Berlin';

export function getDateStringInTimeZone(date: Date, timeZone: string): string {
  if (Number.isNaN(date.getTime())) throw new RangeError('date must be a valid Date.');

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('The requested time zone did not return a complete date.');

  return `${year}-${month}-${day}`;
}

export function getTimeStringInTimeZone(date: Date, timeZone: string): string {
  if (Number.isNaN(date.getTime())) throw new RangeError('date must be a valid Date.');

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  let hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  if (!hour || !minute) throw new Error('The requested time zone did not return a complete time.');
  if (hour === '24') hour = '00';

  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

/**
 * True when `date` falls on a later calendar day than `now`, both seen in the workshop time zone.
 * A payment booked "today" late in the evening (Berlin) is therefore never treated as future.
 */
export function isAfterTodayInTimeZone(date: Date, now: Date, timeZone: string = INVOICE_TIME_ZONE): boolean {
  return getDateStringInTimeZone(date, timeZone) > getDateStringInTimeZone(now, timeZone);
}

export function getYearInTimeZone(date: Date, timeZone: string): number {
  return Number(getDateStringInTimeZone(date, timeZone).slice(0, 4));
}

export function addDaysToDateString(dateString: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match || !Number.isSafeInteger(days)) throw new RangeError('A valid date and integer day offset are required.');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError('dateString must be a valid calendar date.');
  }

  date.setUTCDate(date.getUTCDate() + days);
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}
