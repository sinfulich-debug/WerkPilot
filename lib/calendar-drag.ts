import { eventsOverlap, parseTimeToMinutes, snapMinutes } from './calendar';
import type { Appointment, AppointmentMechanic } from './appointments';

/** The bay where appointments may overlap (walk-in reception), see the exclusion constraint in migration 0013. */
export const OVERLAP_ALLOWED_BAY = 'Direktannahme';

export const MIN_APPOINTMENT_MINUTES = 15;

export type GridMinutes = {
  startMinutes: number;
  endMinutes: number;
};

/** Converts a pointer height inside the grid to minutes since midnight (not snapped, clamped to the grid). */
export function minutesFromPointer(clientY: number, rect: { top: number; height: number }, grid: GridMinutes): number {
  if (!Number.isFinite(clientY) || !(rect.height > 0)) throw new RangeError('pointer position and grid height must be valid.');
  const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
  return grid.startMinutes + ratio * (grid.endMinutes - grid.startMinutes);
}

/**
 * New start time while dragging a card.
 * `grabOffsetMinutes` is how far below the card's top edge the pointer grabbed it,
 * so the card does not jump when the drag begins. Result snaps to the grid and stays inside it.
 */
export function computeMovedStart(
  pointerMinutes: number,
  grabOffsetMinutes: number,
  durationMinutes: number,
  grid: GridMinutes,
  step = 15,
): number {
  const latestStart = Math.max(grid.startMinutes, grid.endMinutes - durationMinutes);
  const snapped = snapMinutes(pointerMinutes - grabOffsetMinutes, step);
  return Math.min(latestStart, Math.max(grid.startMinutes, snapped));
}

/** New duration while dragging the bottom edge: snapped, at least one step, never past the end of the grid. */
export function computeResizedDuration(
  pointerMinutes: number,
  startMinutes: number,
  grid: GridMinutes,
  minimum = MIN_APPOINTMENT_MINUTES,
  step = 15,
): number {
  const maximum = Math.max(minimum, grid.endMinutes - startMinutes);
  const snapped = snapMinutes(pointerMinutes - startMinutes, step);
  return Math.min(maximum, Math.max(minimum, snapped));
}

export type AppointmentMove = {
  date: string;
  time: string;
  durationMinutes: number;
  bay: string;
  mechanicId: string | undefined;
};

function toInterval(appointment: Pick<AppointmentMove, 'time' | 'durationMinutes'>, id: string) {
  const start = parseTimeToMinutes(appointment.time);
  return { id, startMinutes: start, endMinutes: start + appointment.durationMinutes };
}

/**
 * Client-side mirror of the database rules, used to refuse an impossible drop instantly:
 * two appointments on the same day may not overlap in the same bay (except Direktannahme)
 * or for the same mechanic. The database stays the authority and still answers 409.
 */
export function findAppointmentConflict(
  appointments: readonly Appointment[],
  movedId: string,
  candidate: AppointmentMove,
): Appointment | null {
  const moved = toInterval(candidate, movedId);
  for (const other of appointments) {
    if (other.id === movedId || other.date !== candidate.date) continue;
    if (!eventsOverlap(moved, toInterval(other, other.id))) continue;

    const sameBay = candidate.bay === other.bay && candidate.bay !== OVERLAP_ALLOWED_BAY;
    const sameMechanic = candidate.mechanicId !== undefined && candidate.mechanicId === other.mechanicId;
    if (sameBay || sameMechanic) return other;
  }
  return null;
}

export type ResourceMode = 'bay' | 'mechanic';

export type ResourceColumn = {
  key: string;
  title: string;
  /** What a drop or click in this column assigns to the appointment. */
  target: { bay: string } | { mechanicId: string | undefined };
};

export const UNASSIGNED_MECHANIC_KEY = 'unassigned';

/**
 * Columns for the day view. Bays: the workshop's known bays first, then any other bay that
 * appears in the data, so an old appointment never disappears. Mechanics: everyone in the
 * workshop plus an "unassigned" column.
 */
export function getResourceColumns(
  mode: ResourceMode,
  options: {
    knownBays: readonly string[];
    appointments: readonly Appointment[];
    mechanics: readonly AppointmentMechanic[];
  },
): ResourceColumn[] {
  if (mode === 'bay') {
    const bays = [...options.knownBays];
    for (const appointment of options.appointments) {
      if (!bays.includes(appointment.bay)) bays.push(appointment.bay);
    }
    return bays.map((bay) => ({ key: `bay:${bay}`, title: bay, target: { bay } }));
  }

  const columns: ResourceColumn[] = options.mechanics.map((mechanic) => ({
    key: `mechanic:${mechanic.id}`,
    title: mechanic.name,
    target: { mechanicId: mechanic.id },
  }));
  columns.push({
    key: `mechanic:${UNASSIGNED_MECHANIC_KEY}`,
    title: 'Nicht zugewiesen',
    target: { mechanicId: undefined },
  });
  return columns;
}

/** Whether an appointment belongs in a resource column. A mechanic who left the workshop falls back to "unassigned". */
export function appointmentMatchesColumn(
  appointment: Appointment,
  column: ResourceColumn,
  knownMechanicIds: ReadonlySet<string>,
): boolean {
  if ('bay' in column.target) return appointment.bay === column.target.bay;
  const columnMechanic = column.target.mechanicId;
  if (columnMechanic === undefined) {
    return appointment.mechanicId === undefined || !knownMechanicIds.has(appointment.mechanicId);
  }
  return appointment.mechanicId === columnMechanic;
}
