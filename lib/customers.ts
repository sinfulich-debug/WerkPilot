import type { ConsentSource } from './reminder-consent';

export type Customer = {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes?: string;
  archivedAt?: string;
  // Reminder consent (DSGVO). Set only through the dedicated consent actions, never by editing the customer.
  reminderConsentAt?: string;
  reminderConsentSource?: ConsentSource;
  reminderOptOutAt?: string;
};

export type Vehicle = {
  id: string;
  customerId: string;
  make: string;
  plate: string;
  tuvDueDate: string;
  year?: number;
  hsn?: string;
  tsn?: string;
  vin?: string;
  engine?: string;
  tuvIntervalMonths?: number;
  lastReminderSentAt?: string;
  archivedAt?: string;
};

export type CustomerInput = Omit<
  Customer,
  'id' | 'archivedAt' | 'reminderConsentAt' | 'reminderConsentSource' | 'reminderOptOutAt'
>;
export type VehicleInput = Omit<Vehicle, 'id' | 'lastReminderSentAt' | 'archivedAt'>;
export type TuvStatus = 'overdue' | 'soon' | 'ok';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function dateStringToUtcTimestamp(dateString: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) throw new RangeError(`Ungültiges TÜV-Datum: ${dateString}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsedDate = new Date(timestamp);
  if (parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() !== month - 1 || parsedDate.getUTCDate() !== day) {
    throw new RangeError(`Ungültiges TÜV-Datum: ${dateString}`);
  }
  return timestamp;
}

export function getTuvStatus(tuvDueDate: string): { status: TuvStatus; daysUntilDue: number } {
  const today = new Date();
  const todayTimestamp = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const daysUntilDue = Math.round((dateStringToUtcTimestamp(tuvDueDate) - todayTimestamp) / MILLISECONDS_PER_DAY);

  return {
    status: daysUntilDue < 0 ? 'overdue' : daysUntilDue <= 30 ? 'soon' : 'ok',
    daysUntilDue,
  };
}

export function getTodayDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
