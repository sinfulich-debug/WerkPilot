'use client';

import { useEffect, useState } from 'react';
import { isWorkshopSettings, toWorkshopSettings, type WorkshopSettings } from '../workshop-settings';

/**
 * Loads the everyday settings of the workshop (hourly rate, reminder text, bank details) from the
 * database. Until they arrive, or if loading fails, the defaults are used and `error` says why.
 */
export function useWorkshopSettings(): { settings: WorkshopSettings; isLoaded: boolean; error: string | null } {
  const [settings, setSettings] = useState<WorkshopSettings>(() => toWorkshopSettings(null));
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      const response = await fetch('/api/workshop-settings', { cache: 'no-store', signal: controller.signal });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error('Der Server hat eine ungültige Antwort gesendet.');
      }
      const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
      if (!response.ok || record.ok !== true) {
        throw new Error(typeof record.error === 'string' ? record.error : 'Die Werkstatt-Einstellungen konnten nicht geladen werden.');
      }
      if (!isWorkshopSettings(record.settings)) {
        throw new Error('Die Werkstatt-Einstellungen haben ein ungültiges Format.');
      }
      setSettings(record.settings);
      setError(null);
    };
    load()
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : 'Die Werkstatt-Einstellungen konnten nicht geladen werden.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoaded(true);
      });
    return () => controller.abort();
  }, []);

  return { settings, isLoaded, error };
}
