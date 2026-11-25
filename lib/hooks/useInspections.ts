'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSaveQueue,
  describeImport,
  isInspection,
  patchHeader,
  patchItem,
  runLegacyImport,
  type ImportResult,
  type LegacyStore,
} from '../inspection-client';
import { type Inspection, type InspectionHeader, type InspectionStatus } from '../inspections';

const API = '/werkstatt/pruefungen/api';
/** The key where the old version kept inspections inside the browser. */
const LEGACY_KEY = 'werkpilot-inspections';
/** Typing is saved this long after the last key press. */
const SAVE_DELAY_MS = 700;

type ApiResult = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readResponse(response: Response): Promise<ApiResult> {
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error('Der Server hat eine ungültige Antwort gesendet.');
  }
  if (!isRecord(result)) throw new Error('Der Server hat eine ungültige Antwort gesendet.');
  if (!response.ok || result.ok !== true) {
    throw new Error(typeof result.error === 'string' ? result.error : 'Die Fahrzeugprüfungen konnten nicht verarbeitet werden.');
  }
  return result;
}

async function post(action: string, body: unknown): Promise<ApiResult> {
  const response = await fetch(`${API}?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readResponse(response);
}

/** The old browser copy: localStorage, tolerant to blocked storage and broken JSON. */
const legacyStore: LegacyStore = {
  read() {
    try {
      const saved = window.localStorage.getItem(LEGACY_KEY);
      if (!saved) return [];
      const parsed: unknown = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },
  write(entries) {
    try {
      if (entries.length === 0) window.localStorage.removeItem(LEGACY_KEY);
      else window.localStorage.setItem(LEGACY_KEY, JSON.stringify(entries));
    } catch {
      // The browser may block storage; the import then simply runs again next time.
    }
  },
};

function sendImportBatch(batch: unknown[]): Promise<ImportResult> {
  return post('import', { inspections: batch }).then((result) => ({
    imported: typeof result.imported === 'number' ? result.imported : 0,
    skipped: typeof result.skipped === 'number' ? result.skipped : 0,
  }));
}

export function useInspections() {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const latest = useRef<Inspection[]>([]);
  latest.current = inspections;
  const [saveQueue] = useState(() => createSaveQueue(SAVE_DELAY_MS));
  const requestedPhotos = useRef(new Set<string>());
  const legacyImport = useRef<Promise<ImportResult> | null>(null);

  const reportError = useCallback((cause: unknown, fallback: string) => {
    setError(cause instanceof Error ? cause.message : fallback);
  }, []);

  const reload = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const response = await fetch(API, { cache: 'no-store', signal });
    const result = await readResponse(response);
    if (!Array.isArray(result.inspections) || !result.inspections.every(isInspection)) {
      throw new Error('Die Fahrzeugprüfungen haben ein ungültiges Format.');
    }
    setInspections(result.inspections);
    setError(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const start = async () => {
      // Old browser data is moved once; a failure keeps the rest in the browser for the next visit.
      // In development React runs this effect twice: both runs wait for the same single import.
      if (!legacyImport.current && legacyStore.read().length > 0) {
        legacyImport.current = runLegacyImport(legacyStore, sendImportBatch);
      }
      if (legacyImport.current) {
        try {
          const message = describeImport(await legacyImport.current);
          if (message && !controller.signal.aborted) setNotice(message);
        } catch (importError) {
          if (!controller.signal.aborted) {
            setError(`${importError instanceof Error ? importError.message : 'Der Import ist fehlgeschlagen.'} Die alten Daten bleiben im Browser erhalten.`);
          }
        }
      }
      await reload(controller.signal);
    };
    void start()
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) reportError(loadError, 'Die Fahrzeugprüfungen konnten nicht geladen werden.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoaded(true);
      });
    return () => controller.abort();
  }, [reload, reportError]);

  // Unsaved typing is sent when the page is left.
  useEffect(() => () => saveQueue.flush(), [saveQueue]);

  const addInspection = useCallback(async (): Promise<string | null> => {
    setError(null);
    try {
      const result = await post('create', {});
      if (!isInspection(result.inspection)) throw new Error('Der Server hat eine ungültige Antwort gesendet.');
      const created = result.inspection;
      setInspections((current) => [created, ...current]);
      return created.id;
    } catch (cause) {
      reportError(cause, 'Die Prüfung konnte nicht angelegt werden.');
      return null;
    }
  }, [reportError]);

  const updateHeader = useCallback((id: string, changes: Partial<InspectionHeader>) => {
    setInspections((current) => patchHeader(current, id, changes));
    saveQueue.schedule(`header:${id}`, () => {
      const inspection = latest.current.find((entry) => entry.id === id);
      if (!inspection) return;
      post('updateHeader', {
        id,
        customerName: inspection.customerName,
        vehicleLabel: inspection.vehicleLabel,
        plate: inspection.plate,
      }).catch((cause: unknown) => reportError(cause, 'Die Änderung konnte nicht gespeichert werden.'));
    });
  }, [reportError, saveQueue]);

  const setItemStatus = useCallback(async (inspectionId: string, itemId: string, status: InspectionStatus) => {
    setInspections((current) => patchItem(current, inspectionId, itemId, { status }));
    try {
      await post('updateItem', { itemId, status });
    } catch (cause) {
      reportError(cause, 'Die Änderung konnte nicht gespeichert werden.');
    }
  }, [reportError]);

  const setItemNote = useCallback((inspectionId: string, itemId: string, note: string) => {
    setInspections((current) => patchItem(current, inspectionId, itemId, { note }));
    saveQueue.schedule(`note:${itemId}`, () => {
      post('updateItem', { itemId, note })
        .catch((cause: unknown) => reportError(cause, 'Die Änderung konnte nicht gespeichert werden.'));
    });
  }, [reportError, saveQueue]);

  const setPhoto = useCallback(async (inspectionId: string, itemId: string, dataUrl: string): Promise<boolean> => {
    setError(null);
    try {
      await post('setPhoto', { itemId, photo: dataUrl });
      requestedPhotos.current.add(itemId);
      setPhotos((current) => ({ ...current, [itemId]: dataUrl }));
      setInspections((current) => patchItem(current, inspectionId, itemId, { hasPhoto: true }));
      return true;
    } catch (cause) {
      reportError(cause, 'Das Foto konnte nicht gespeichert werden.');
      return false;
    }
  }, [reportError]);

  const removePhoto = useCallback(async (inspectionId: string, itemId: string) => {
    setError(null);
    try {
      await post('deletePhoto', { itemId });
      setPhotos((current) => {
        const { [itemId]: _removed, ...rest } = current;
        return rest;
      });
      requestedPhotos.current.delete(itemId);
      setInspections((current) => patchItem(current, inspectionId, itemId, { hasPhoto: false }));
    } catch (cause) {
      reportError(cause, 'Das Foto konnte nicht entfernt werden.');
    }
  }, [reportError]);

  /** Loads the picture of one item the first time it is needed (the list itself carries no photos). */
  const loadPhoto = useCallback(async (itemId: string) => {
    if (requestedPhotos.current.has(itemId)) return;
    requestedPhotos.current.add(itemId);
    try {
      const response = await fetch(`${API}?photo=${encodeURIComponent(itemId)}`, { cache: 'no-store' });
      const result = await readResponse(response);
      if (typeof result.photo === 'string') {
        const photo = result.photo;
        setPhotos((current) => ({ ...current, [itemId]: photo }));
      }
    } catch (cause) {
      requestedPhotos.current.delete(itemId);
      reportError(cause, 'Das Foto konnte nicht geladen werden.');
    }
  }, [reportError]);

  return {
    inspections,
    photos,
    isLoaded,
    error,
    notice,
    addInspection,
    updateHeader,
    setItemStatus,
    setItemNote,
    setPhoto,
    removePhoto,
    loadPhoto,
    reload,
  };
}
