'use client';

import { useEffect, useState } from 'react';

export function usePersistentState<T>(
  key: string,
  initialValue: T,
  isValid: (value: unknown) => value is T,
) {
  const [value, setValue] = useState(initialValue);
  const [isLoaded, setIsLoaded] = useState(false);
  const [canPersist, setCanPersist] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const savedValue = window.localStorage.getItem(key);
      if (savedValue !== null) {
        const parsed: unknown = JSON.parse(savedValue);
        if (!isValid(parsed)) throw new Error('Das gespeicherte Format ist ungültig.');
        setValue(parsed);
      }
    } catch (error) {
      console.error(`Daten für "${key}" konnten nicht geladen werden.`, error);
      setCanPersist(false);
      setStorageError('Gespeicherte Daten konnten nicht gelesen werden. Änderungen bleiben zunächst nur in diesem Browserfenster erhalten.');
    } finally {
      setIsLoaded(true);
    }
  }, [isValid, key]);

  useEffect(() => {
    if (!isLoaded || !canPersist) return;

    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      setStorageError(null);
    } catch (error) {
      console.error(`Daten für "${key}" konnten nicht gespeichert werden.`, error);
      setStorageError('Änderungen konnten nicht dauerhaft gespeichert werden. Bitte prüfe den verfügbaren Browserspeicher.');
    }
  }, [canPersist, isLoaded, key, value]);

  return { value, setValue, isLoaded, storageError };
}
