'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_WORKSHOP_NAME } from '../reminders';

export function useWorkshopName(): string {
  const [workshopName, setWorkshopName] = useState(DEFAULT_WORKSHOP_NAME);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/workshop-name', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        let value: unknown;
        try {
          value = await response.json();
        } catch {
          throw new Error('Der Server hat eine ungültige Antwort gesendet.');
        }
        if (!response.ok || typeof value !== 'object' || value === null || !('companyName' in value)) {
          throw new Error('Der Werkstattname konnte nicht geladen werden.');
        }
        const name = value.companyName;
        setWorkshopName(typeof name === 'string' && name.trim() ? name.trim() : DEFAULT_WORKSHOP_NAME);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error('Der Werkstattname konnte nicht geladen werden.', error);
        }
      });

    return () => controller.abort();
  }, []);

  return workshopName;
}
