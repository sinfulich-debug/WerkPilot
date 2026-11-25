import { addDaysToDateString, getDateStringInTimeZone, getTimeStringInTimeZone } from './date';

const GERMAN_MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
] as const;

const GERMAN_WEEKDAYS = [
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag',
] as const;

export const ISO_WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;
export type WeekdayLabel = (typeof ISO_WEEKDAY_LABELS)[number];

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type IntervalEvent = {
  id: string;
  startMinutes: number;
  endMinutes: number;
};

export type PositionedEvent<T extends IntervalEvent> = T & {
  column: number;
  columnSpan: number;
  columnCount: number;
};

export type DayEventInput = {
  id: string;
  time: string;
  durationMinutes: number;
};

export type DayEventPlacement = {
  id: string;
  column: number;
  columnSpan: number;
  columnCount: number;
  topPercent: number;
  heightPercent: number;
};

export type SlotTone = 'outside' | 'lunch' | 'work';

export type CalendarSlot = {
  time: string;
  startMinutes: number;
  tone: SlotTone;
  isHourStart: boolean;
};

export type CalendarBounds = {
  gridStart: string;
  gridEnd: string;
  slotMinutes: number;
  workStart: string;
  workEnd: string;
  lunchStart: string;
  lunchEnd: string;
};

export type NowMarker = {
  date: string;
  topPercent: number;
};

function parseCalendarDate(dateString: string): Date {
  const normalized = addDaysToDateString(dateString, 0);
  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(5, 7));
  const day = Number(normalized.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day));
}

export function parseTimeToMinutes(time: string): number {
  const match = TIME_PATTERN.exec(time);
  if (!match) throw new RangeError('time must be HH:MM.');
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatMinutesAsTime(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60) {
    throw new RangeError('minutes must be an integer from 0 to 1440.');
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function eventsOverlap(a: IntervalEvent, b: IntervalEvent): boolean {
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

export function getIsoWeekday(dateString: string): number {
  const day = parseCalendarDate(dateString).getUTCDay();
  return day === 0 ? 7 : day;
}

export function getWeekdayLabel(dateString: string): WeekdayLabel {
  return ISO_WEEKDAY_LABELS[getIsoWeekday(dateString) - 1];
}

export function getIsoWeekStart(dateString: string): string {
  return addDaysToDateString(dateString, 1 - getIsoWeekday(dateString));
}

export function getIsoWeekDates(dateString: string): string[] {
  const start = getIsoWeekStart(dateString);
  return Array.from({ length: 7 }, (_, index) => addDaysToDateString(start, index));
}

/** ISO 8601 week: the week belongs to the year that contains its Thursday (so 2024-12-30 is 2025 W1). */
export function getIsoWeek(dateString: string): { year: number; week: number } {
  const date = parseCalendarDate(dateString);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const dayOfYear = Math.floor((date.getTime() - yearStart.getTime()) / 86_400_000) + 1;
  return { year, week: Math.ceil(dayOfYear / 7) };
}

export function getIsoWeekNumber(dateString: string): number {
  return getIsoWeek(dateString).week;
}

/** A plain time range in minutes since midnight, end exclusive. */
export type MinuteInterval = {
  startMinutes: number;
  endMinutes: number;
};

function assertInterval(interval: MinuteInterval): void {
  if (!Number.isFinite(interval.startMinutes) || !Number.isFinite(interval.endMinutes)) {
    throw new RangeError('interval times must be finite numbers.');
  }
  if (interval.endMinutes < interval.startMinutes) {
    throw new RangeError('interval end must not be before its start.');
  }
}

/** Rounds to the nearest grid step (halves round up). Used so dragged cards land on the 15-minute grid. */
export function snapMinutes(minutes: number, step = 15): number {
  if (!Number.isFinite(minutes)) throw new RangeError('minutes must be a finite number.');
  if (!Number.isInteger(step) || step <= 0) throw new RangeError('step must be a positive integer.');
  return Math.round(minutes / step) * step;
}

/** Joins overlapping or touching ranges into the smallest set of ranges. Empty ranges are dropped. */
export function mergeIntervals(intervals: readonly MinuteInterval[]): MinuteInterval[] {
  intervals.forEach(assertInterval);

  const sorted = intervals
    .filter((interval) => interval.endMinutes > interval.startMinutes)
    .map((interval) => ({ startMinutes: interval.startMinutes, endMinutes: interval.endMinutes }))
    .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);

  const merged: MinuteInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.startMinutes <= last.endMinutes) {
      last.endMinutes = Math.max(last.endMinutes, interval.endMinutes);
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

/** Minutes of the working window that are still free after removing breaks and absences. */
export function availableMinutes(window: MinuteInterval, unavailable: readonly MinuteInterval[] = []): number {
  assertInterval(window);

  const clipped = unavailable.map((interval) => {
    assertInterval(interval);
    return {
      startMinutes: Math.max(interval.startMinutes, window.startMinutes),
      endMinutes: Math.min(interval.endMinutes, window.endMinutes),
    };
  });
  const blocked = mergeIntervals(clipped.filter((interval) => interval.endMinutes > interval.startMinutes));
  const blockedTotal = blocked.reduce((sum, interval) => sum + (interval.endMinutes - interval.startMinutes), 0);
  return window.endMinutes - window.startMinutes - blockedTotal;
}

/** Booked share of the available time as a whole percent. Can be above 100 when overbooked; 0 when nothing is available. */
export function utilizationPercent(bookedMinutes: number, available: number): number {
  if (!Number.isFinite(bookedMinutes) || bookedMinutes < 0) {
    throw new RangeError('bookedMinutes must be a non-negative number.');
  }
  if (!Number.isFinite(available)) throw new RangeError('available must be a finite number.');
  if (available <= 0) return 0;
  return Math.round((bookedMinutes / available) * 100);
}

export function formatLongGermanDate(dateString: string): string {
  const date = parseCalendarDate(dateString);
  return `${date.getUTCDate()}. ${GERMAN_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function formatLongGermanDateWithWeekday(dateString: string): string {
  return `${GERMAN_WEEKDAYS[getIsoWeekday(dateString) - 1]}, ${formatLongGermanDate(dateString)}`;
}

export function formatWeekRange(startDate: string, endDate: string): string {
  return `${formatLongGermanDate(startDate)} – ${formatLongGermanDate(endDate)}`;
}

export function getCalendarDayNumber(dateString: string): number {
  return parseCalendarDate(dateString).getUTCDate();
}

function positionCluster<T extends IntervalEvent>(cluster: readonly T[]): PositionedEvent<T>[] {
  const columnEnds: number[] = [];
  const assigned: Array<{ event: T; column: number }> = [];

  for (const event of cluster) {
    let column = columnEnds.findIndex((end) => end <= event.startMinutes);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(event.endMinutes);
    } else {
      columnEnds[column] = event.endMinutes;
    }
    assigned.push({ event, column });
  }

  const columnCount = columnEnds.length;
  return assigned.map(({ event, column }) => {
    let columnSpan = 1;
    for (let next = column + 1; next < columnCount; next += 1) {
      const blocked = assigned.some(
        (other) => other.column === next && eventsOverlap(event, other.event),
      );
      if (blocked) break;
      columnSpan += 1;
    }
    return { ...event, column, columnSpan, columnCount };
  });
}

/** Places overlapping appointments side by side. A shared bay cannot overlap in the database, so concurrent cards belong to different bays and split the day column. */
export function layoutOverlappingEvents<T extends IntervalEvent>(events: readonly T[]): PositionedEvent<T>[] {
  for (const event of events) {
    if (!Number.isFinite(event.startMinutes) || !Number.isFinite(event.endMinutes)) {
      throw new RangeError('event times must be finite numbers.');
    }
    if (event.endMinutes < event.startMinutes) {
      throw new RangeError('event end must not be before its start.');
    }
  }

  const sorted = [...events].sort((a, b) => {
    if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
    if (a.endMinutes !== b.endMinutes) return b.endMinutes - a.endMinutes;
    return a.id.localeCompare(b.id);
  });

  const positioned: PositionedEvent<T>[] = [];
  let cluster: T[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const flush = () => {
    if (cluster.length === 0) return;
    positioned.push(...positionCluster(cluster));
    cluster = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };

  for (const event of sorted) {
    if (cluster.length > 0 && event.startMinutes >= clusterEnd) flush();
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, event.endMinutes);
  }
  flush();

  return positioned;
}

export function layoutDayAppointments(
  events: readonly DayEventInput[],
  grid: { gridStart: string; gridEnd: string },
): DayEventPlacement[] {
  const gridStart = parseTimeToMinutes(grid.gridStart);
  const gridEnd = parseTimeToMinutes(grid.gridEnd);
  if (gridEnd <= gridStart) throw new RangeError('grid end must be after grid start.');

  const visible: IntervalEvent[] = [];
  for (const event of events) {
    if (!Number.isFinite(event.durationMinutes) || event.durationMinutes <= 0) continue;
    let start: number;
    try {
      start = parseTimeToMinutes(event.time);
    } catch {
      continue;
    }
    const clippedStart = Math.max(start, gridStart);
    const clippedEnd = Math.min(start + event.durationMinutes, gridEnd);
    if (clippedEnd <= clippedStart) continue;
    visible.push({ id: event.id, startMinutes: clippedStart, endMinutes: clippedEnd });
  }

  const span = gridEnd - gridStart;
  return layoutOverlappingEvents(visible).map((event) => ({
    id: event.id,
    column: event.column,
    columnSpan: event.columnSpan,
    columnCount: event.columnCount,
    topPercent: ((event.startMinutes - gridStart) / span) * 100,
    heightPercent: ((event.endMinutes - event.startMinutes) / span) * 100,
  }));
}

function slotTone(startMinutes: number, bounds: CalendarBounds): SlotTone {
  const lunchStart = parseTimeToMinutes(bounds.lunchStart);
  const lunchEnd = parseTimeToMinutes(bounds.lunchEnd);
  if (startMinutes >= lunchStart && startMinutes < lunchEnd) return 'lunch';

  const workStart = parseTimeToMinutes(bounds.workStart);
  const workEnd = parseTimeToMinutes(bounds.workEnd);
  if (startMinutes < workStart || startMinutes >= workEnd) return 'outside';
  return 'work';
}

export function buildDaySlots(bounds: CalendarBounds): CalendarSlot[] {
  if (!Number.isInteger(bounds.slotMinutes) || bounds.slotMinutes <= 0) {
    throw new RangeError('slotMinutes must be a positive integer.');
  }

  const gridStart = parseTimeToMinutes(bounds.gridStart);
  const gridEnd = parseTimeToMinutes(bounds.gridEnd);
  if (gridEnd <= gridStart) throw new RangeError('grid end must be after grid start.');
  if ((gridEnd - gridStart) % bounds.slotMinutes !== 0) {
    throw new RangeError('grid range must be divisible by slotMinutes.');
  }

  const slots: CalendarSlot[] = [];
  for (let start = gridStart; start < gridEnd; start += bounds.slotMinutes) {
    slots.push({
      time: formatMinutesAsTime(start),
      startMinutes: start,
      tone: slotTone(start, bounds),
      isHourStart: start % 60 === 0,
    });
  }
  return slots;
}

export function getNowMarker(now: Date, timeZone: string, gridStart: string, gridEnd: string): NowMarker | null {
  const date = getDateStringInTimeZone(now, timeZone);
  const minutes = parseTimeToMinutes(getTimeStringInTimeZone(now, timeZone));
  const start = parseTimeToMinutes(gridStart);
  const end = parseTimeToMinutes(gridEnd);
  if (minutes < start || minutes > end) return null;

  return {
    date,
    topPercent: ((minutes - start) / (end - start)) * 100,
  };
}
