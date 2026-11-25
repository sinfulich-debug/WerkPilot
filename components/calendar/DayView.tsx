'use client';

import { useMemo } from 'react';
import type { Absence } from '../../lib/absences';
import type { Appointment, AppointmentMechanic } from '../../lib/appointments';
import { formatLongGermanDateWithWeekday, getIsoWeekNumber } from '../../lib/calendar';
import { getResourceColumns, type ResourceColumn } from '../../lib/calendar-drag';
import { toCalendarBounds, type CalendarSettings } from '../../lib/calendar-settings';
import type { AppointmentMovePatch } from '../../lib/hooks/useAppointments';
import { buildDateColumns, buildResourceColumns, type CalendarDayContext } from './columns';
import TimeGrid from './TimeGrid';

export type DayGrouping = 'none' | 'bay' | 'mechanic';

type DayViewProps = {
  date: string;
  today: string;
  now: Date | null;
  appointments: readonly Appointment[];
  /** Every appointment, for the utilization numbers; defaults to `appointments` (which a search may have filtered). */
  allAppointments?: readonly Appointment[];
  settings: CalendarSettings;
  absences: readonly Absence[];
  /** One column for the whole day, or one per bay / mechanic. */
  grouping: DayGrouping;
  knownBays: readonly string[];
  mechanics: readonly AppointmentMechanic[];
  onSlotClick: (date: string, time: string, target?: ResourceColumn['target']) => void;
  onAppointmentClick: (appointment: Appointment) => void;
  onAppointmentChange?: (appointment: Appointment, change: AppointmentMovePatch) => void;
};

export default function DayView({
  date,
  today,
  now,
  appointments,
  allAppointments,
  settings,
  absences,
  grouping,
  knownBays,
  mechanics,
  onSlotClick,
  onAppointmentClick,
  onAppointmentChange,
}: DayViewProps) {
  const bounds = useMemo(() => toCalendarBounds(settings), [settings]);
  const utilizationSource = allAppointments ?? appointments;
  const columns = useMemo(() => {
    const context: CalendarDayContext = {
      settings,
      absences,
      appointments: utilizationSource,
      mechanicNames: new Map(mechanics.map((mechanic) => [mechanic.id, mechanic.name])),
    };
    if (grouping === 'none') return buildDateColumns([date], today, context);
    const dayAppointments = appointments.filter((appointment) => appointment.date === date);
    const resources = getResourceColumns(grouping, { knownBays, appointments: dayAppointments, mechanics });
    return buildResourceColumns(date, today, resources, new Set(mechanics.map((mechanic) => mechanic.id)), context);
  }, [absences, appointments, date, grouping, knownBays, mechanics, settings, today, utilizationSource]);

  return (
    <TimeGrid
      columns={columns}
      bounds={bounds}
      now={now}
      weekNumber={getIsoWeekNumber(date)}
      appointments={appointments}
      ariaLabel={formatLongGermanDateWithWeekday(date)}
      onSlotClick={onSlotClick}
      onAppointmentClick={onAppointmentClick}
      onAppointmentChange={onAppointmentChange}
    />
  );
}
