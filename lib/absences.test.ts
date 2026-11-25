import { describe, expect, it } from 'vitest';
import {
  AbsenceError,
  describeAbsence,
  findMechanicAbsence,
  getAbsencesOnDate,
  parseAbsenceInput,
  type Absence,
} from './absences';

const mechanicId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const valid = { mechanicId, startDate: '2026-12-21', endDate: '2026-12-31', type: 'Urlaub' };

describe('parseAbsenceInput', () => {
  it('accepts a valid absence and trims the note', () => {
    expect(parseAbsenceInput({ ...valid, note: '  Winterurlaub ' })).toEqual({ ...valid, note: 'Winterurlaub' });
    expect(parseAbsenceInput({ ...valid, note: '   ' }).note).toBeUndefined();
    expect(parseAbsenceInput({ ...valid, startDate: '2026-12-21', endDate: '2026-12-21' })).toMatchObject({
      startDate: '2026-12-21',
    });
  });

  it('rejects a bad mechanic, type or date with a German message', () => {
    expect(() => parseAbsenceInput({ ...valid, mechanicId: 'x' })).toThrow('Mitarbeiter');
    expect(() => parseAbsenceInput({ ...valid, type: 'Ferien' })).toThrow('Art der Abwesenheit');
    expect(() => parseAbsenceInput({ ...valid, startDate: '2026-02-31' })).toThrow('kein gültiges Datum');
    expect(() => parseAbsenceInput({ ...valid, endDate: undefined })).toThrow('Enddatum fehlt');
    expect(() => parseAbsenceInput(null)).toThrow(AbsenceError);
  });

  it('rejects an end before the start and absurdly long ranges', () => {
    expect(() => parseAbsenceInput({ ...valid, startDate: '2026-12-31', endDate: '2026-12-21' })).toThrow(
      'nicht vor dem Startdatum',
    );
    // 366 days counting both ends is the limit
    expect(() => parseAbsenceInput({ ...valid, startDate: '2026-01-01', endDate: '2027-01-02' })).toThrow(
      'höchstens 366 Tage',
    );
    expect(parseAbsenceInput({ ...valid, startDate: '2026-01-01', endDate: '2027-01-01' }).endDate).toBe('2027-01-01');
  });

  it('rejects an over-long note', () => {
    expect(() => parseAbsenceInput({ ...valid, note: 'x'.repeat(201) })).toThrow('200 Zeichen');
  });
});

describe('absences on a day', () => {
  const absences: Absence[] = [
    { id: '1', mechanicId, startDate: '2026-12-21', endDate: '2026-12-23', type: 'Urlaub' },
    { id: '2', mechanicId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', startDate: '2026-12-23', endDate: '2026-12-23', type: 'Krank', note: 'Grippe' },
  ];

  it('includes both end days of the range', () => {
    expect(getAbsencesOnDate(absences, '2026-12-20')).toEqual([]);
    expect(getAbsencesOnDate(absences, '2026-12-21').map((item) => item.id)).toEqual(['1']);
    expect(getAbsencesOnDate(absences, '2026-12-23').map((item) => item.id)).toEqual(['1', '2']);
    expect(getAbsencesOnDate(absences, '2026-12-24')).toEqual([]);
  });

  it('finds the absence of one mechanic', () => {
    expect(findMechanicAbsence(absences, mechanicId, '2026-12-22')?.id).toBe('1');
    expect(findMechanicAbsence(absences, mechanicId, '2026-12-25')).toBeNull();
    expect(findMechanicAbsence(absences, undefined, '2026-12-22')).toBeNull();
  });

  it('describes an absence with its note', () => {
    expect(describeAbsence(absences[0])).toBe('Urlaub');
    expect(describeAbsence(absences[1])).toBe('Krank (Grippe)');
  });
});
