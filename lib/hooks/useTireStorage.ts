'use client';

import { useCallback, useEffect, useState } from 'react';
import { isTireSeason, type TireStorage, type TireStorageInput } from '../tire-storage';

const API = '/reifenlager/api';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTireStorage(value: unknown): value is TireStorage {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.customerId === 'string' &&
    typeof value.slot === 'string' &&
    isTireSeason(value.season) &&
    typeof value.description === 'string' &&
    typeof value.storedAt === 'string' &&
    (value.vehicleId === undefined || typeof value.vehicleId === 'string') &&
    (value.treadDepthTenthMm === undefined || typeof value.treadDepthTenthMm === 'number') &&
    (value.releasedAt === undefined || typeof value.releasedAt === 'string') &&
    (value.lastReminderSentAt === undefined || typeof value.lastReminderSentAt === 'string') &&
    (value.notes === undefined || typeof value.notes === 'string')
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Die Anfrage ist fehlgeschlagen. Bitte versuche es erneut.';
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error('Der Server hat eine ungültige Antwort gesendet.');
  }
  if (!isRecord(value)) throw new Error('Der Server hat eine ungültige Antwort gesendet.');
  if (!response.ok || value.ok !== true) {
    throw new Error(typeof value.error === 'string' ? value.error : 'Die Anfrage ist fehlgeschlagen. Bitte versuche es erneut.');
  }
  return value;
}

export function useTireStorage() {
  const [sets, setSets] = useState<TireStorage[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(API, { cache: 'no-store', signal });
    const result = await readResponse(response);
    if (!Array.isArray(result.tireStorages) || !result.tireStorages.every(isTireStorage)) {
      throw new Error('Die Reifenlager-Daten haben ein ungültiges Format.');
    }
    setSets(result.tireStorages);
    setError(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal)
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoaded(true);
      });
    return () => controller.abort();
  }, [reload]);

  const mutate = useCallback(
    async (action: string, body: unknown): Promise<boolean> => {
      setError(null);
      try {
        const response = await fetch(`${API}?action=${encodeURIComponent(action)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        await readResponse(response);
        await reload();
        return true;
      } catch (mutationError) {
        setError(errorMessage(mutationError));
        return false;
      }
    },
    [reload],
  );

  const addSet = useCallback((input: TireStorageInput) => mutate('create', input), [mutate]);
  const releaseSet = useCallback((id: string) => mutate('release', { id }), [mutate]);
  const markReminderSent = useCallback((id: string) => mutate('markReminderSent', { id }), [mutate]);

  return { sets, isLoaded, error, addSet, releaseSet, markReminderSent };
}
