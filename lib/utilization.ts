import { findMechanicAbsence, type Absence } from './absences';
import type { Appointment } from './appointments';
import { availableMinutes, getIsoWeekday, parseTimeToMinutes, utilizationPercent, type MinuteInterval } from './calendar';
import { getLunchBreaks, getWorkWindow, type CalendarSettings } from './calendar-settings';
import { getHolidayName } from './holidays';

export type Utilization = {
  bookedMinutes: number;
  availableMinutes: number;
  /** Whole percent, can be above 100 when overbooked. null when nothing is available (holiday, everyone away). */
  percent: number | null;
};

/** Minutes of an appointment that fall inside the working window (a 07:00 start only counts from opening time). */
function minutesInsideWindow(appointment: Appointment, window: MinuteInterval): number {
  const start = parseTimeToMinutes(appointment.time);
  const end = start + appointment.durationMinutes;
  return Math.max(0, Math.min(end, window.endMinutes) - Math.max(start, window.startMinutes));
}

function toUtilization(bookedMinutes: number, available: number): Utilization {
  return {
    bookedMinutes,
    availableMinutes: available,
    percent: available > 0 ? utilizationPercent(bookedMinutes, available) : null,
  };
}

export type UtilizationInput = {
  date: string;
  /** Appointments of the scope (the whole day, one bay or one mechanic); other days are ignored. */
  appointments: readonly Appointment[];
  /**
   * The people whose time counts as capacity: each id is one worker, `undefined` is a worker who can
   * never be absent (used when the workshop has no mechanics yet, or for a bay). An empty list means no capacity.
   */
  workers: readonly (string | undefined)[];
  settings: CalendarSettings;
  absences: readonly Absence[];
};

/**
 * Booked share of the available time on one day.
 * Capacity per worker = working hours minus lunch minus absence; a public holiday has none.
 * A Saturday or Sunday only counts as a working day when something is booked on it.
 */
export function getUtilization({ date, appointments, workers, settings, absences }: UtilizationInput): Utilization {
  const window = getWorkWindow(settings);
  const dayAppointments = appointments.filter((appointment) => appointment.date === date);
  const booked = dayAppointments.reduce((sum, appointment) => sum + minutesInsideWindow(appointment, window), 0);

  const isHoliday = getHolidayName(date, settings.bundesland) !== null;
  const isClosedWeekend = getIsoWeekday(date) >= 6 && dayAppointments.length === 0;
  if (isHoliday || isClosedWeekend) return toUtilization(booked, 0);

  const lunch = getLunchBreaks(settings);
  const capacity = workers.reduce((sum, workerId) => {
    const isAway = findMechanicAbsence(absences, workerId, date) !== null;
    return sum + availableMinutes(window, isAway ? [window] : lunch);
  }, 0);
  return toUtilization(booked, capacity);
}

/** Adds several days (or columns) together, e.g. for the week total. */
export function sumUtilization(parts: readonly Utilization[]): Utilization {
  return toUtilization(
    parts.reduce((sum, part) => sum + part.bookedMinutes, 0),
    parts.reduce((sum, part) => sum + part.availableMinutes, 0),
  );
}

/** "5,5 von 8 Std." for a tooltip. */
export function formatUtilizationHours(value: Utilization): string {
  const hours = (minutes: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(minutes / 60);
  return `${hours(value.bookedMinutes)} von ${hours(value.availableMinutes)} Std.`;
}
