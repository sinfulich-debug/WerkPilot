'use client';

import { useMemo } from 'react';
import type { Absence } from '../../lib/absences';
import type { Appointment, AppointmentMechanic } from '../../lib/appointments';
import { getIsoWeekDates, getIsoWeekNumber } from '../../lib/calendar';
import { toCalendarBounds, type CalendarSettings } from '../../lib/calendar-settings';
import type { AppointmentMovePatch } from '../../lib/hooks/useAppointments';
import { buildDateColumns, type CalendarDayContext } from './columns';
import TimeGrid from './TimeGrid';

type WeekViewProps = {
  anchorDate: string;
  today: string;
  now: Date | null;
  appointments: readonly Appointment[];
  /** Every appointment, for the utilization numbers; defaults to `appointments` (which a search may have filtered). */
  allAppointments?: readonly Appointment[];
  settings: CalendarSettings;
  absences: readonly Absence[];
  mechanics: readonly AppointmentMechanic[];
  onSlotClick: (date: string, time: string) => void;
  onAppointmentClick: (appointment: Appointment) => void;
  onAppointmentChange?: (appointment: Appointment, change: AppointmentMovePatch) => void;
};

export default function WeekView({
  anchorDate,
  today,
  now,
  appointments,
  allAppointments,
  settings,
  absences,
  mechanics,
  onSlotClick,
  onAppointmentClick,
  onAppointmentChange,
}: WeekViewProps) {
  const days = useMemo(() => getIsoWeekDates(anchorDate), [anchorDate]);
  const bounds = useMemo(() => toCalendarBounds(settings), [settings]);
  const utilizationSource = allAppointments ?? appointments;
  const columns = useMemo(() => {
    const context: CalendarDayContext = {
      settings,
      absences,
      appointments: utilizationSource,
      mechanicNames: new Map(mechanics.map((mechanic) => [mechanic.id, mechanic.name])),
    };
    return buildDateColumns(days, today, context);
  }, [absences, days, mechanics, settings, today, utilizationSource]);
  const weekNumber = getIsoWeekNumber(days[0]);

  return (
    <TimeGrid
      columns={columns}
      bounds={bounds}
      now={now}
      weekNumber={weekNumber}
      appointments={appointments}
      ariaLabel={`Kalenderwoche ${weekNumber}`}
      onSlotClick={onSlotClick}
      onAppointmentClick={onAppointmentClick}
      onAppointmentChange={onAppointmentChange}
    />
  );
}
