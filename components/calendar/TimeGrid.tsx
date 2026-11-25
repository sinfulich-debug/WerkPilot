'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Appointment, AppointmentStatus } from '../../lib/appointments';
import {
  buildDaySlots,
  formatLongGermanDateWithWeekday,
  formatMinutesAsTime,
  getNowMarker,
  layoutDayAppointments,
  parseTimeToMinutes,
  type CalendarBounds,
  type CalendarSlot,
  type DayEventPlacement,
} from '../../lib/calendar';
import { CALENDAR_GRID_END, CALENDAR_GRID_START } from '../../lib/calendar-config';
import {
  computeMovedStart,
  computeResizedDuration,
  minutesFromPointer,
  type ResourceColumn,
} from '../../lib/calendar-drag';
import { INVOICE_TIME_ZONE } from '../../lib/date';
import { formatUtilizationHours } from '../../lib/utilization';
import type { AppointmentMovePatch } from '../../lib/hooks/useAppointments';
import { getColumnState, type CalendarColumn } from './columns';

const STATUS_CLASS: Record<AppointmentStatus, string> = {
  Bestätigt: 'border-emerald-400 bg-emerald-100 text-emerald-950 hover:bg-emerald-200',
  Ausstehend: 'border-amber-400 bg-amber-100 text-amber-950 hover:bg-amber-200',
  Abgeschlossen: 'border-slate-300 bg-slate-200 text-slate-700 hover:bg-slate-300',
};

const GRID_MINUTES = {
  startMinutes: parseTimeToMinutes(CALENDAR_GRID_START),
  endMinutes: parseTimeToMinutes(CALENDAR_GRID_END),
};

/** How far the pointer must travel before a press counts as a drag instead of a click. */
const DRAG_THRESHOLD_PX = 5;

function slotClass(slot: CalendarSlot, isToday: boolean, state: 'normal' | 'holiday' | 'absent'): string {
  // A holiday or an absent mechanic shades the whole column; otherwise outside hours and lunch are shaded.
  const tone =
    state === 'holiday'
      ? 'bg-rose-100/70'
      : state === 'absent'
        ? 'bg-amber-100/70'
        : slot.tone === 'lunch'
          ? 'bg-slate-300/80'
          : slot.tone === 'outside'
            ? 'bg-slate-200/70'
            : isToday
              ? 'bg-accent-50/50'
              : 'bg-white';
  const border = slot.isHourStart ? 'border-slate-200' : 'border-slate-100';
  return `border-t ${border} ${tone} hover:bg-slate-100 focus-visible:relative focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent-600`;
}

function hourSpan(slots: readonly CalendarSlot[], index: number): number {
  let span = 1;
  for (let cursor = index + 1; cursor < slots.length && !slots[cursor].isHourStart; cursor += 1) span += 1;
  return span;
}

type DragMode = 'move' | 'resize';

type DragState = {
  appointment: Appointment;
  mode: DragMode;
  pointerId: number;
  startX: number;
  startY: number;
  grabOffsetMinutes: number;
  originColumnKey: string;
  originStartMinutes: number;
  originDurationMinutes: number;
  moved: boolean;
  columnKey: string;
  startMinutes: number;
  durationMinutes: number;
};

type DragPreview = {
  appointmentId: string;
  columnKey: string;
  startMinutes: number;
  durationMinutes: number;
};

export type TimeGridProps = {
  columns: readonly CalendarColumn[];
  /** Visible range plus the workshop's hours and lunch break. */
  bounds: CalendarBounds;
  now: Date | null;
  weekNumber?: number;
  appointments: readonly Appointment[];
  ariaLabel: string;
  onSlotClick: (date: string, time: string, target?: ResourceColumn['target']) => void;
  onAppointmentClick: (appointment: Appointment) => void;
  /** Called after a card was dragged or resized. Omit it to make the grid read-only. */
  onAppointmentChange?: (appointment: Appointment, change: AppointmentMovePatch) => void;
};

export default function TimeGrid({
  columns,
  bounds,
  now,
  weekNumber,
  appointments,
  ariaLabel,
  onSlotClick,
  onAppointmentClick,
  onAppointmentChange,
}: TimeGridProps) {
  const slots = useMemo(() => buildDaySlots(bounds), [bounds]);
  const marker = useMemo(
    () => (now ? getNowMarker(now, INVOICE_TIME_ZONE, CALENDAR_GRID_START, CALENDAR_GRID_END) : null),
    [now],
  );

  const layerRefs = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const [preview, setPreview] = useState<DragPreview | null>(null);

  const columnAppointments = useMemo(() => {
    const byColumn = new Map<string, Appointment[]>();
    for (const column of columns) byColumn.set(column.key, appointments.filter(column.match));
    return byColumn;
  }, [appointments, columns]);

  const placements = useMemo(() => {
    const byColumn = new Map<string, Map<string, DayEventPlacement>>();
    for (const column of columns) {
      const laidOut = layoutDayAppointments(
        (columnAppointments.get(column.key) ?? []).map((appointment) => ({
          id: appointment.id,
          time: appointment.time,
          durationMinutes: appointment.durationMinutes,
        })),
        { gridStart: CALENDAR_GRID_START, gridEnd: CALENDAR_GRID_END },
      );
      byColumn.set(column.key, new Map(laidOut.map((item) => [item.id, item])));
    }
    return byColumn;
  }, [columnAppointments, columns]);

  // Escape cancels a drag in progress.
  useEffect(() => {
    if (!preview) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (dragRef.current?.moved) suppressClickRef.current = true;
      dragRef.current = null;
      setPreview(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preview]);

  const columnKeyAtX = (clientX: number, fallbackKey: string): string => {
    let nearestKey = fallbackKey;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const column of columns) {
      const rect = layerRefs.current.get(column.key)?.getBoundingClientRect();
      if (!rect) continue;
      if (clientX >= rect.left && clientX <= rect.right) return column.key;
      const distance = Math.min(Math.abs(clientX - rect.left), Math.abs(clientX - rect.right));
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestKey = column.key;
      }
    }
    return nearestKey;
  };

  const beginDrag = (
    event: ReactPointerEvent<HTMLElement>,
    appointment: Appointment,
    column: CalendarColumn,
    mode: DragMode,
  ) => {
    if (!onAppointmentChange || appointment.status === 'Abgeschlossen' || event.button !== 0) return;
    const layer = layerRefs.current.get(column.key);
    if (!layer) return;

    const startMinutes = parseTimeToMinutes(appointment.time);
    const pointerMinutes = minutesFromPointer(event.clientY, layer.getBoundingClientRect(), GRID_MINUTES);
    dragRef.current = {
      appointment,
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      grabOffsetMinutes: pointerMinutes - startMinutes,
      originColumnKey: column.key,
      originStartMinutes: startMinutes,
      originDurationMinutes: appointment.durationMinutes,
      moved: false,
      columnKey: column.key,
      startMinutes,
      durationMinutes: appointment.durationMinutes,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;

    if (drag.mode === 'move') {
      const columnKey = columnKeyAtX(event.clientX, drag.originColumnKey);
      const layer = layerRefs.current.get(columnKey);
      if (!layer) return;
      const pointerMinutes = minutesFromPointer(event.clientY, layer.getBoundingClientRect(), GRID_MINUTES);
      drag.columnKey = columnKey;
      drag.startMinutes = computeMovedStart(pointerMinutes, drag.grabOffsetMinutes, drag.originDurationMinutes, GRID_MINUTES);
    } else {
      const layer = layerRefs.current.get(drag.originColumnKey);
      if (!layer) return;
      const pointerMinutes = minutesFromPointer(event.clientY, layer.getBoundingClientRect(), GRID_MINUTES);
      drag.durationMinutes = computeResizedDuration(pointerMinutes, drag.originStartMinutes, GRID_MINUTES);
    }

    setPreview({
      appointmentId: drag.appointment.id,
      columnKey: drag.columnKey,
      startMinutes: drag.startMinutes,
      durationMinutes: drag.durationMinutes,
    });
  };

  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setPreview(null);
    if (!drag.moved) return;

    // The click that follows a drag must not open the edit dialog.
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);

    const column = columns.find((item) => item.key === drag.columnKey);
    if (!column || !onAppointmentChange) return;

    const unchanged =
      drag.columnKey === drag.originColumnKey &&
      drag.startMinutes === drag.originStartMinutes &&
      drag.durationMinutes === drag.originDurationMinutes;
    if (unchanged) return;

    const change: AppointmentMovePatch = {
      date: column.date,
      time: formatMinutesAsTime(drag.startMinutes),
      durationMinutes: drag.durationMinutes,
    };
    if (column.target && 'bay' in column.target) change.bay = column.target.bay;
    if (column.target && 'mechanicId' in column.target) change.mechanicId = column.target.mechanicId;
    onAppointmentChange(drag.appointment, change);
  };

  const cancelDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) suppressClickRef.current = true;
    dragRef.current = null;
    setPreview(null);
  };

  const minWidth = `calc(4.5rem + ${columns.length} * 120px)`;
  const markerColumns = marker ? columns.filter((column) => column.date === marker.date) : [];
  const canChange = onAppointmentChange !== undefined;

  return (
    // overflow-x:auto turns the vertical axis into "auto" as well. The "20:00" label below the grid sticks out a few
    // pixels, which made this wrapper draw a second, useless vertical scrollbar next to the real one. The wrapper only
    // scrolls sideways; the padding gives the label room.
    <div className="overflow-x-auto overflow-y-hidden pb-3">
      <div
        role="group"
        aria-label={ariaLabel}
        className="grid"
        style={{
          width: `max(100%, ${minWidth})`,
          gridTemplateColumns: `4.5rem repeat(${columns.length}, minmax(120px, 1fr))`,
          gridTemplateRows: `auto repeat(${slots.length}, 1.75rem)`,
        }}
      >
        <div className="sticky left-0 z-40 flex items-end justify-end border-b border-r border-slate-200 bg-white px-2 pb-2 text-[13px] font-medium text-slate-500">
          {weekNumber !== undefined ? `KW ${weekNumber}` : null}
        </div>
        {columns.map((column) => (
          <div
            key={column.key}
            className={`border-b border-l border-slate-200 px-2 py-2 text-center ${column.isToday ? 'bg-slate-100 text-slate-800' : 'bg-white text-slate-600'}`}
            aria-current={column.isToday && column.variant === 'date' ? 'date' : undefined}
          >
            {column.variant === 'date' ? (
              <>
                <div className="text-[11px] font-medium">{column.title}</div>
                <div className={`text-lg font-medium leading-none ${column.isToday ? 'text-accent-700' : 'text-slate-900'}`}>
                  {column.subtitle}
                </div>
              </>
            ) : (
              <div className="truncate text-sm font-medium leading-tight text-slate-900" title={column.title}>
                {column.title}
              </div>
            )}
            {column.holiday && (
              <div
                className="mt-1 truncate rounded bg-rose-100 px-1 py-0.5 text-[10px] font-medium leading-tight text-rose-800"
                title={`Feiertag: ${column.holiday}`}
              >
                {column.holiday}
              </div>
            )}
            {column.absence && (
              <div
                className="mt-1 truncate rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium leading-tight text-amber-900"
                title={`Abwesend: ${column.absence}`}
              >
                {column.absence}
              </div>
            )}
            {column.utilization && column.utilization.percent !== null && (
              <div
                className="mt-1"
                title={`Auslastung ${column.utilization.percent} % (${formatUtilizationHours(column.utilization)})`}
              >
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${column.utilization.percent > 100 ? 'bg-rose-500' : column.utilization.percent >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(100, column.utilization.percent)}%` }}
                  />
                </div>
                <div className="mt-0.5 text-[10px] font-medium leading-none text-slate-500">
                  {column.utilization.percent} %
                </div>
              </div>
            )}
            {column.absentLabels?.slice(0, 2).map((label) => (
              <div
                key={label}
                className="mt-1 truncate rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium leading-tight text-amber-900"
                title={label}
              >
                {label}
              </div>
            ))}
            {column.absentLabels && column.absentLabels.length > 2 && (
              <div className="mt-1 text-[10px] font-medium text-amber-900" title={column.absentLabels.join('\n')}>
                +{column.absentLabels.length - 2} weitere
              </div>
            )}
          </div>
        ))}

        {columns.map((column, columnIndex) =>
          slots.map((slot, slotIndex) => (
            <button
              key={`${column.key}-${slot.time}`}
              type="button"
              aria-label={`Termin am ${formatLongGermanDateWithWeekday(column.date)} um ${slot.time}${column.variant === 'resource' ? `, ${column.title}` : ''} anlegen`}
              onClick={() => onSlotClick(column.date, slot.time, column.target)}
              className={slotClass(slot, column.isToday, getColumnState(column))}
              style={{ gridColumn: columnIndex + 2, gridRow: slotIndex + 2 }}
            />
          )),
        )}

        {slots.map((slot, index) =>
          slot.isHourStart ? (
            <div
              key={slot.time}
              style={{ gridColumn: 1, gridRow: `${index + 2} / span ${hourSpan(slots, index)}` }}
              className="sticky left-0 z-30 border-r border-slate-200 bg-white"
            >
              <span
                className={`block pr-2 text-right text-[11px] font-medium leading-none text-slate-400 ${index === 0 ? 'pt-0.5' : '-translate-y-1/2'}`}
              >
                {slot.time}
              </span>
            </div>
          ) : null,
        )}

        <div className="pointer-events-none sticky left-0 z-30" style={{ gridColumn: 1, gridRow: '2 / -1' }}>
          <span className="absolute bottom-0 right-2 translate-y-1/2 bg-white px-0.5 text-[11px] font-medium text-slate-400">
            {CALENDAR_GRID_END}
          </span>
          {marker && markerColumns.length > 0 && (
            <span
              className="absolute right-1.5 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-rose-500"
              style={{ top: `${marker.topPercent}%` }}
            />
          )}
        </div>

        {columns.map((column, columnIndex) => {
          const columnPlacements = placements.get(column.key);
          const showLine = marker !== null && marker.date === column.date;
          const span = GRID_MINUTES.endMinutes - GRID_MINUTES.startMinutes;
          return (
            <div
              key={`${column.key}-events`}
              ref={(element) => {
                if (element) layerRefs.current.set(column.key, element);
                else layerRefs.current.delete(column.key);
              }}
              className="pointer-events-none relative z-10"
              style={{ gridColumn: columnIndex + 2, gridRow: '2 / -1' }}
            >
              {(columnAppointments.get(column.key) ?? []).map((appointment) => {
                const placement = columnPlacements?.get(appointment.id);
                if (!placement) return null;
                const draggable = canChange && appointment.status !== 'Abgeschlossen';
                const isBeingDragged = preview?.appointmentId === appointment.id;
                return (
                  <button
                    key={appointment.id}
                    type="button"
                    aria-label={`${appointment.time} ${appointment.customer}, Kennzeichen ${appointment.plate}, ${appointment.status}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      onAppointmentClick(appointment);
                    }}
                    onPointerDown={(event) => beginDrag(event, appointment, column, 'move')}
                    onPointerMove={updateDrag}
                    onPointerUp={finishDrag}
                    onPointerCancel={cancelDrag}
                    className={`pointer-events-auto absolute select-none overflow-hidden rounded-md border px-1 py-0.5 text-left shadow-sm ${STATUS_CLASS[appointment.status]} ${draggable ? 'cursor-grab touch-none active:cursor-grabbing' : ''} ${isBeingDragged ? 'opacity-40' : ''}`}
                    style={{
                      top: `calc(${placement.topPercent}% + 1px)`,
                      height: `max(1.25rem, calc(${placement.heightPercent}% - 2px))`,
                      left: `calc(${(placement.column / placement.columnCount) * 100}% + 2px)`,
                      width: `calc(${(placement.columnSpan / placement.columnCount) * 100}% - 4px)`,
                    }}
                  >
                    <span className="block truncate text-[11px] font-medium leading-tight">{appointment.time}</span>
                    <span className="block truncate text-[11px] font-medium leading-tight">{appointment.customer}</span>
                    <span className="block truncate text-[10px] leading-tight opacity-80">{appointment.plate}</span>
                    {draggable && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize bg-black/5 hover:bg-black/15"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          beginDrag(event, appointment, column, 'resize');
                        }}
                      />
                    )}
                  </button>
                );
              })}

              {preview && preview.columnKey === column.key && (
                <div
                  className="pointer-events-none absolute inset-x-0.5 z-30 rounded-md border-2 border-dashed border-accent-600 bg-slate-200 px-1 py-0.5 text-[11px] font-medium text-slate-950 shadow-lg"
                  style={{
                    top: `${((preview.startMinutes - GRID_MINUTES.startMinutes) / span) * 100}%`,
                    height: `${(preview.durationMinutes / span) * 100}%`,
                  }}
                >
                  {formatMinutesAsTime(preview.startMinutes)}–
                  {formatMinutesAsTime(Math.min(preview.startMinutes + preview.durationMinutes, 24 * 60))}
                </div>
              )}

              {showLine && marker && (
                <div className="absolute inset-x-1 z-20" style={{ top: `${marker.topPercent}%` }}>
                  <div className="h-0.5 -translate-y-1/2 bg-rose-500" />
                  <span className="sr-only">Aktuelle Uhrzeit</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
