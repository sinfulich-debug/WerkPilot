import { describe, expect, it } from 'vitest';
import type { Absence } from '../../lib/absences';
import type { Appointment } from '../../lib/appointments';
import { getResourceColumns } from '../../lib/calendar-drag';
import { DEFAULT_CALENDAR_SETTINGS } from '../../lib/calendar-settings';
import { buildDateColumns, buildResourceColumns, getColumnState, type CalendarDayContext } from './columns';

const max = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const eva = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const absences: Absence[] = [
  { id: '1', mechanicId: max, startDate: '2026-11-18', endDate: '2026-11-19', type: 'Urlaub' },
  { id: '2', mechanicId: eva, startDate: '2026-11-18', endDate: '2026-11-18', type: 'Krank', note: 'Grippe' },
];
const context = (
  bundesland: CalendarDayContext['settings']['bundesland'],
  appointments: Appointment[] = [],
): CalendarDayContext => ({
  settings: { ...DEFAULT_CALENDAR_SETTINGS, bundesland },
  absences,
  appointments,
  mechanicNames: new Map([
    [max, 'Max'],
    [eva, 'Eva'],
  ]),
});

describe('date columns', () => {
  const days = ['2026-11-17', '2026-11-18', '2026-11-19'];

  it('marks the holiday of the Bundesland, and only there', () => {
    const saxony = buildDateColumns(days, '2026-11-17', context('SN'));
    expect(saxony.map((column) => column.holiday)).toEqual([undefined, 'Buß- und Bettag', undefined]);

    const bavaria = buildDateColumns(days, '2026-11-17', context('BY'));
    expect(bavaria.every((column) => column.holiday === undefined)).toBe(true);
  });

  it('lists who is away on each day with the reason', () => {
    const columns = buildDateColumns(days, '2026-11-17', context('BY'));
    expect(columns[0].absentLabels).toEqual([]);
    expect(columns[1].absentLabels).toEqual(['Max: Urlaub', 'Eva: Krank (Grippe)']);
    expect(columns[2].absentLabels).toEqual(['Max: Urlaub']);
  });

  it('falls back to a generic name for a member who is not in the mechanic list', () => {
    const noNames = { ...context('BY'), mechanicNames: new Map<string, string>() };
    expect(buildDateColumns(['2026-11-19'], '2026-11-19', noNames)[0].absentLabels).toEqual(['Mitarbeiter: Urlaub']);
  });

  it('flags today and keeps weekday and day number', () => {
    const [first] = buildDateColumns(days, '2026-11-17', context('BY'));
    expect(first).toMatchObject({ title: 'Di', subtitle: '17', isToday: true, variant: 'date' });
  });
});

describe('column utilization', () => {
  const booking = (id: string, date: string, durationMinutes: number, mechanicId?: string, bay = 'Reifen 1'): Appointment => ({
    id, date, mechanicId, bay, time: '09:00', durationMinutes, customer: 'A', vehicle: 'V', plate: 'P', reason: 'R',
    status: 'Bestätigt', tone: 'success',
  });

  it('counts the whole team in a date column and removes mechanics who are away', () => {
    const appointments = [booking('1', '2026-11-17', 240), booking('2', '2026-11-18', 240)];
    const [tuesday, wednesday] = buildDateColumns(['2026-11-17', '2026-11-18'], '2026-11-17', context('BY', appointments));
    expect(tuesday.utilization).toMatchObject({ availableMinutes: 960, percent: 25 });
    // Wednesday: Max (Urlaub) and Eva (Krank) are both away, so there is no capacity left
    expect(wednesday.utilization).toMatchObject({ availableMinutes: 0, percent: null });
  });

  it('gives a mechanic column that mechanic\'s time and a bay column the workshop hours', () => {
    const appointments = [booking('1', '2026-11-20', 240, max, 'Reifen 1'), booking('2', '2026-11-20', 120, eva, 'Achsvermessung')];
    const mechanics = [{ id: max, name: 'Max' }, { id: eva, name: 'Eva' }];
    const known = new Set([max, eva]);

    const byMechanic = buildResourceColumns(
      '2026-11-20', '2026-11-17',
      getResourceColumns('mechanic', { knownBays: [], appointments, mechanics }), known, context('BY', appointments),
    );
    expect(byMechanic[0].utilization).toMatchObject({ bookedMinutes: 240, availableMinutes: 480, percent: 50 });
    expect(byMechanic[1].utilization).toMatchObject({ bookedMinutes: 120, percent: 25 });
    expect(byMechanic[2].utilization).toBeUndefined(); // "unassigned" has no capacity

    const byBay = buildResourceColumns(
      '2026-11-20', '2026-11-17',
      getResourceColumns('bay', { knownBays: ['Reifen 1', 'Achsvermessung'], appointments, mechanics }), known, context('BY', appointments),
    );
    expect(byBay[0].utilization).toMatchObject({ bookedMinutes: 240, availableMinutes: 480, percent: 50 });
    expect(byBay[1].utilization).toMatchObject({ bookedMinutes: 120, percent: 25 });
  });

  it('shows no percentage in the column of a mechanic who is away', () => {
    const mechanics = [{ id: max, name: 'Max' }];
    const columns = buildResourceColumns(
      '2026-11-18', '2026-11-17',
      getResourceColumns('mechanic', { knownBays: [], appointments: [], mechanics }), new Set([max]), context('BY'),
    );
    expect(columns[0].utilization?.percent).toBeNull();
  });
});

describe('resource columns', () => {
  const mechanics = [
    { id: max, name: 'Max' },
    { id: eva, name: 'Eva' },
  ];
  const resources = getResourceColumns('mechanic', { knownBays: [], appointments: [], mechanics });
  const known = new Set(mechanics.map((mechanic) => mechanic.id));

  it('shades the column of a mechanic who is away and only on that day', () => {
    const away = buildResourceColumns('2026-11-18', '2026-11-17', resources, known, context('BY'));
    expect(away.map((column) => column.absence)).toEqual(['Urlaub', 'Krank (Grippe)', undefined]);
    expect(away.map(getColumnState)).toEqual(['absent', 'absent', 'normal']);

    const back = buildResourceColumns('2026-11-20', '2026-11-17', resources, known, context('BY'));
    expect(back.map(getColumnState)).toEqual(['normal', 'normal', 'normal']);
  });

  it('closes every column on a public holiday, which wins over an absence', () => {
    const columns = buildResourceColumns('2026-11-18', '2026-11-17', resources, known, context('SN'));
    expect(columns.map(getColumnState)).toEqual(['holiday', 'holiday', 'holiday']);
  });

  it('keeps only the appointments of the column day and mechanic', () => {
    const appointment = (id: string, date: string, mechanicId?: string): Appointment => ({
      id, date, mechanicId, time: '09:00', durationMinutes: 60, bay: 'Reifen 1', customer: 'A', vehicle: 'V',
      plate: 'P', reason: 'R', status: 'Bestätigt', tone: 'success',
    });
    const [maxColumn, , unassigned] = buildResourceColumns('2026-11-20', '2026-11-17', resources, known, context('BY'));
    expect(maxColumn.match(appointment('1', '2026-11-20', max))).toBe(true);
    expect(maxColumn.match(appointment('2', '2026-11-21', max))).toBe(false);
    expect(maxColumn.match(appointment('3', '2026-11-20', eva))).toBe(false);
    expect(unassigned.match(appointment('4', '2026-11-20'))).toBe(true);
  });
});
