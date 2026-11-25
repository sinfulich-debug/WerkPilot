import { describeAbsence, findMechanicAbsence, getAbsencesOnDate, type Absence } from '../../lib/absences';
import type { Appointment } from '../../lib/appointments';
import { getCalendarDayNumber, getWeekdayLabel } from '../../lib/calendar';
import { appointmentMatchesColumn, type ResourceColumn } from '../../lib/calendar-drag';
import type { CalendarSettings } from '../../lib/calendar-settings';
import { getHolidayName } from '../../lib/holidays';
import { getUtilization, type Utilization } from '../../lib/utilization';

/**
 * What the calendar needs to know about the days: the workshop settings (Bundesland, hours),
 * who is away, and every appointment so that utilization does not change with the search filter.
 */
export type CalendarDayContext = {
  settings: CalendarSettings;
  absences: readonly Absence[];
  mechanicNames: ReadonlyMap<string, string>;
  appointments: readonly Appointment[];
};

/** One vertical column of the time grid: a day (week view) or a bay / mechanic on one day (day view). */
export type CalendarColumn = {
  key: string;
  date: string;
  title: string;
  /** Large number under a weekday label; only used by date columns. */
  subtitle?: string;
  variant: 'date' | 'resource';
  isToday: boolean;
  /** Name of the public holiday; the whole column is shaded as closed. */
  holiday?: string;
  /** Who is away on this day, e.g. "Max: Urlaub" (date columns). */
  absentLabels?: string[];
  /** This mechanic column belongs to someone who is away, e.g. "Urlaub". */
  absence?: string;
  /** Booked share of the available time; absent when the column has no capacity of its own. */
  utilization?: Utilization;
  /** What a click or drop in this column assigns to the appointment (resource columns only). */
  target?: ResourceColumn['target'];
  match: (appointment: Appointment) => boolean;
};

/** Tone of the whole column background: normal, closed (holiday) or the mechanic is away. */
export function getColumnState(column: Pick<CalendarColumn, 'holiday' | 'absence'>): 'normal' | 'holiday' | 'absent' {
  if (column.holiday) return 'holiday';
  if (column.absence) return 'absent';
  return 'normal';
}

function mechanicName(context: CalendarDayContext, mechanicId: string): string {
  return context.mechanicNames.get(mechanicId) ?? 'Mitarbeiter';
}

export function buildDateColumns(days: readonly string[], today: string, context: CalendarDayContext): CalendarColumn[] {
  // A workshop without any mechanic still has one person's worth of capacity.
  const workers: (string | undefined)[] =
    context.mechanicNames.size > 0 ? Array.from(context.mechanicNames.keys()) : [undefined];
  return days.map((day) => ({
    key: day,
    date: day,
    title: getWeekdayLabel(day),
    subtitle: String(getCalendarDayNumber(day)),
    variant: 'date',
    isToday: day === today,
    holiday: getHolidayName(day, context.settings.bundesland) ?? undefined,
    absentLabels: getAbsencesOnDate(context.absences, day).map(
      (absence) => `${mechanicName(context, absence.mechanicId)}: ${describeAbsence(absence)}`,
    ),
    utilization: getUtilization({
      date: day,
      appointments: context.appointments,
      workers,
      settings: context.settings,
      absences: context.absences,
    }),
    match: (appointment) => appointment.date === day,
  }));
}

export function buildResourceColumns(
  date: string,
  today: string,
  resources: readonly ResourceColumn[],
  knownMechanicIds: ReadonlySet<string>,
  context: CalendarDayContext,
): CalendarColumn[] {
  const holiday = getHolidayName(date, context.settings.bundesland) ?? undefined;
  return resources.map((resource) => {
    const mechanicId = 'mechanicId' in resource.target ? resource.target.mechanicId : undefined;
    const absence = findMechanicAbsence(context.absences, mechanicId, date);
    const matches = (appointment: Appointment) =>
      appointment.date === date && appointmentMatchesColumn(appointment, resource, knownMechanicIds);

    // A bay has the workshop's hours; a mechanic column has that mechanic's time; "unassigned" has none.
    const isMechanicColumn = 'mechanicId' in resource.target;
    const workers: (string | undefined)[] = isMechanicColumn ? (mechanicId ? [mechanicId] : []) : [undefined];
    const utilization =
      isMechanicColumn && !mechanicId
        ? undefined
        : getUtilization({
            date,
            appointments: context.appointments.filter(matches),
            workers,
            settings: context.settings,
            absences: context.absences,
          });

    return {
      key: resource.key,
      date,
      title: resource.title,
      variant: 'resource',
      isToday: date === today,
      holiday,
      absence: absence ? describeAbsence(absence) : undefined,
      utilization,
      target: resource.target,
      match: matches,
    };
  });
}
