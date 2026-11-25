import { describe, expect, it } from 'vitest';
import type { Appointment } from './appointments';
import {
  appointmentMatchesColumn,
  computeMovedStart,
  computeResizedDuration,
  findAppointmentConflict,
  getResourceColumns,
  minutesFromPointer,
} from './calendar-drag';

const grid = { startMinutes: 6 * 60, endMinutes: 20 * 60 };

function appointment(overrides: Partial<Appointment> & Pick<Appointment, 'id'>): Appointment {
  return {
    date: '2026-11-17',
    time: '09:00',
    durationMinutes: 60,
    bay: 'Reifen 1',
    customer: 'Anna',
    vehicle: 'VW Golf',
    plate: 'S-WN 1234',
    reason: 'HU',
    status: 'Bestätigt',
    tone: 'success',
    ...overrides,
  };
}

describe('minutesFromPointer', () => {
  const rect = { top: 100, height: 840 }; // 1 px = 1 minute

  it('maps the pointer height to minutes and clamps outside the grid', () => {
    expect(minutesFromPointer(100, rect, grid)).toBe(360);
    expect(minutesFromPointer(310, rect, grid)).toBe(570);
    expect(minutesFromPointer(940, rect, grid)).toBe(1200);
    expect(minutesFromPointer(50, rect, grid)).toBe(360);
    expect(minutesFromPointer(2000, rect, grid)).toBe(1200);
  });

  it('rejects an empty grid', () => {
    expect(() => minutesFromPointer(10, { top: 0, height: 0 }, grid)).toThrow(RangeError);
  });
});

describe('computeMovedStart', () => {
  it('keeps the grab point and snaps to 15 minutes', () => {
    // grabbed 20 min below the top edge, pointer at 09:40 -> card top at 09:20 -> snaps to 09:15
    expect(computeMovedStart(9 * 60 + 40, 20, 60, grid)).toBe(9 * 60 + 15);
    // pointer at 09:45 -> top at 09:25 -> snaps to 09:30
    expect(computeMovedStart(9 * 60 + 45, 20, 60, grid)).toBe(9 * 60 + 30);
  });

  it('never moves a card outside the grid', () => {
    expect(computeMovedStart(5 * 60, 0, 60, grid)).toBe(6 * 60);
    expect(computeMovedStart(19 * 60 + 50, 0, 90, grid)).toBe(20 * 60 - 90);
    expect(computeMovedStart(10 * 60, 0, 24 * 60, grid)).toBe(6 * 60);
  });
});

describe('computeResizedDuration', () => {
  it('snaps the new length to 15 minutes', () => {
    expect(computeResizedDuration(10 * 60 + 40, 9 * 60, grid)).toBe(105);
    expect(computeResizedDuration(10 * 60 + 30, 9 * 60, grid)).toBe(90);
  });

  it('keeps at least 15 minutes and stops at the end of the grid', () => {
    expect(computeResizedDuration(8 * 60, 9 * 60, grid)).toBe(15);
    expect(computeResizedDuration(9 * 60 + 5, 9 * 60, grid)).toBe(15);
    expect(computeResizedDuration(23 * 60, 18 * 60, grid)).toBe(120);
  });
});

describe('findAppointmentConflict', () => {
  const existing = [
    appointment({ id: 'a', time: '09:00', durationMinutes: 60, bay: 'Reifen 1', mechanicId: 'm1' }),
    appointment({ id: 'b', time: '14:00', durationMinutes: 60, bay: 'Achsvermessung' }),
    appointment({ id: 'c', time: '09:00', durationMinutes: 60, bay: 'Direktannahme' }),
  ];
  const base = { date: '2026-11-17', time: '09:30', durationMinutes: 30, bay: 'Achsvermessung', mechanicId: undefined };

  it('finds an overlap in the same bay', () => {
    expect(findAppointmentConflict(existing, 'x', { ...base, bay: 'Reifen 1' })?.id).toBe('a');
  });

  it('finds an overlap for the same mechanic in a different bay', () => {
    expect(findAppointmentConflict(existing, 'x', { ...base, mechanicId: 'm1' })?.id).toBe('a');
  });

  it('allows touching ends, other days and other bays', () => {
    expect(findAppointmentConflict(existing, 'x', { ...base, bay: 'Reifen 1', time: '10:00' })).toBeNull();
    expect(findAppointmentConflict(existing, 'x', { ...base, bay: 'Reifen 1', date: '2026-11-18' })).toBeNull();
    expect(findAppointmentConflict(existing, 'x', base)).toBeNull();
  });

  it('lets Direktannahme overlap and ignores the moved appointment itself', () => {
    expect(findAppointmentConflict(existing, 'x', { ...base, bay: 'Direktannahme' })).toBeNull();
    expect(findAppointmentConflict(existing, 'a', { ...base, bay: 'Reifen 1', time: '09:15' })).toBeNull();
  });
});

describe('resource columns', () => {
  const appointments = [
    appointment({ id: '1', bay: 'Reifen 1', mechanicId: 'm1' }),
    appointment({ id: '2', bay: 'Hebebühne 9' }),
    appointment({ id: '3', bay: 'Reifen 1', mechanicId: 'gone' }),
  ];
  const mechanics = [
    { id: 'm1', name: 'Mechaniker 1' },
    { id: 'm2', name: 'Mechaniker 2' },
  ];
  const knownBays = ['Reifen 1', 'Achsvermessung', 'Direktannahme'];

  it('lists the known bays first and appends bays that only appear in the data', () => {
    const columns = getResourceColumns('bay', { knownBays, appointments, mechanics });
    expect(columns.map((column) => column.title)).toEqual([
      'Reifen 1',
      'Achsvermessung',
      'Direktannahme',
      'Hebebühne 9',
    ]);
    expect(columns[0].target).toEqual({ bay: 'Reifen 1' });
  });

  it('lists every mechanic and an unassigned column', () => {
    const columns = getResourceColumns('mechanic', { knownBays, appointments, mechanics });
    expect(columns.map((column) => column.title)).toEqual(['Mechaniker 1', 'Mechaniker 2', 'Nicht zugewiesen']);
    expect(columns[2].target).toEqual({ mechanicId: undefined });
  });

  it('puts an appointment of a departed mechanic into the unassigned column', () => {
    const columns = getResourceColumns('mechanic', { knownBays, appointments, mechanics });
    const known = new Set(mechanics.map((mechanic) => mechanic.id));
    const unassigned = columns[2];
    expect(appointmentMatchesColumn(appointments[0], columns[0], known)).toBe(true);
    expect(appointmentMatchesColumn(appointments[0], unassigned, known)).toBe(false);
    expect(appointmentMatchesColumn(appointments[1], unassigned, known)).toBe(true);
    expect(appointmentMatchesColumn(appointments[2], unassigned, known)).toBe(true);
  });

  it('matches bay columns by bay name', () => {
    const columns = getResourceColumns('bay', { knownBays, appointments, mechanics });
    const known = new Set<string>();
    expect(appointmentMatchesColumn(appointments[0], columns[0], known)).toBe(true);
    expect(appointmentMatchesColumn(appointments[0], columns[1], known)).toBe(false);
  });
});
