export const CALENDAR_GRID_START = '06:00';
export const CALENDAR_GRID_END = '20:00';
export const CALENDAR_SLOT_MINUTES = 15;
export const WORKDAY_START = '08:00';
export const WORKDAY_END = '17:00';
export const LUNCH_START = '12:00';
export const LUNCH_END = '13:00';

export const calendarBounds = {
  gridStart: CALENDAR_GRID_START,
  gridEnd: CALENDAR_GRID_END,
  slotMinutes: CALENDAR_SLOT_MINUTES,
  workStart: WORKDAY_START,
  workEnd: WORKDAY_END,
  lunchStart: LUNCH_START,
  lunchEnd: LUNCH_END,
} as const;
