'use client';

import { useCallback, useEffect, useState } from 'react';
import { ABSENCE_TYPES, type Absence, type AbsenceInput } from '../absences';
import { DEFAULT_CALENDAR_SETTINGS, parseCalendarSettings, type CalendarSettings } from '../calendar-settings';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbsence(value: unknown): value is Absence {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.mechanicId === 'string' &&
    typeof value.startDate === 'string' &&
    typeof value.endDate === 'string' &&
    typeof value.type === 'string' &&
    (ABSENCE_TYPES as readonly string[]).includes(value.type) &&
    (value.note === undefined || typeof value.note === 'string')
  );
}

const GENERIC_ERROR = 'Die Anfrage ist fehlgeschlagen. Bitte versuche es erneut.';

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error('Der Server hat eine ungültige Antwort gesendet.');
  }
  if (!isRecord(value)) throw new Error('Der Server hat eine ungültige Antwort gesendet.');
  if (!response.ok || value.ok !== true) throw new Error(typeof value.error === 'string' ? value.error : GENERIC_ERROR);
  return value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : GENERIC_ERROR;
}

/**
 * Calendar settings (Bundesland, hours) and absences of the workshop.
 * Until the data has loaded, the defaults are used so the grid can render immediately.
 * The functions that change data return null on success or a German error message.
 */
export function useCalendarData() {
  const [settings, setSettings] = useState<CalendarSettings>(DEFAULT_CALENDAR_SETTINGS);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await readResponse(await fetch('/termine/kalender/api', { cache: 'no-store', signal }));
    if (!Array.isArray(result.absences) || !result.absences.every(isAbsence)) {
      throw new Error('Die Abwesenheitsdaten haben ein ungültiges Format.');
    }
    setSettings(parseCalendarSettings(result.settings));
    setAbsences(result.absences);
    setCanEdit(result.canEdit === true);
    setError(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(messageOf(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoaded(true);
      });
    return () => controller.abort();
  }, [load]);

  const send = useCallback(
    async (action: string, body: unknown): Promise<string | null> => {
      try {
        await readResponse(
          await fetch(`/termine/kalender/api?action=${encodeURIComponent(action)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        );
        await load();
        return null;
      } catch (sendError) {
        return messageOf(sendError);
      }
    },
    [load],
  );

  const saveSettings = useCallback((next: CalendarSettings) => send('saveSettings', next), [send]);
  const addAbsence = useCallback((input: AbsenceInput) => send('createAbsence', input), [send]);
  const removeAbsence = useCallback((id: string) => send('deleteAbsence', { id }), [send]);

  return { settings, absences, canEdit, isLoaded, error, saveSettings, addAbsence, removeAbsence };
}
