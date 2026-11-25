/**
 * Small pure helpers behind the useInspections hook. They contain no React and no fetch, so they
 * can be tested on their own: shape check of server data, immutable list updates, the one-time
 * import of old browser data and the delayed-save queue.
 */
import {
  IMPORT_BATCH_SIZE,
  isInspectionStatus,
  isUuid,
  type Inspection,
  type InspectionHeader,
  type InspectionItem,
} from './inspections';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks that data from the server has the shape the page relies on. */
export function isInspection(value: unknown): value is Inspection {
  if (!isRecord(value) || !isUuid(value.id)) return false;
  if (typeof value.customerName !== 'string' || typeof value.vehicleLabel !== 'string' || typeof value.plate !== 'string') {
    return false;
  }
  return Array.isArray(value.items) && value.items.every((item) => (
    isRecord(item) &&
    isUuid(item.id) &&
    typeof item.label === 'string' &&
    isInspectionStatus(item.status) &&
    typeof item.note === 'string' &&
    typeof item.hasPhoto === 'boolean'
  ));
}

/** Returns a new list where the header fields of one inspection are changed (the old list stays untouched). */
export function patchHeader(list: Inspection[], id: string, changes: Partial<InspectionHeader>): Inspection[] {
  return list.map((inspection) => (inspection.id === id ? { ...inspection, ...changes } : inspection));
}

/** Returns a new list where one checklist item is changed. */
export function patchItem(
  list: Inspection[],
  inspectionId: string,
  itemId: string,
  changes: Partial<Pick<InspectionItem, 'status' | 'note' | 'hasPhoto'>>,
): Inspection[] {
  return list.map((inspection) => (
    inspection.id !== inspectionId ? inspection : {
      ...inspection,
      items: inspection.items.map((item) => (item.id === itemId ? { ...item, ...changes } : item)),
    }
  ));
}

/** Where the old browser copy lives (localStorage in the app, a fake in tests). */
export type LegacyStore = {
  read: () => unknown[];
  write: (entries: unknown[]) => void;
};

export type ImportResult = { imported: number; skipped: number };

/**
 * Sends the old browser entries to the server in small batches. After every successful batch the
 * browser copy shrinks to what is still unsent, so a retry after a failure never imports twice.
 * When everything went through the copy is empty (and the store removes its key).
 */
export async function runLegacyImport(
  store: LegacyStore,
  send: (batch: unknown[]) => Promise<ImportResult>,
): Promise<ImportResult> {
  const entries = store.read();
  const total: ImportResult = { imported: 0, skipped: 0 };
  for (let start = 0; start < entries.length; start += IMPORT_BATCH_SIZE) {
    const result = await send(entries.slice(start, start + IMPORT_BATCH_SIZE));
    total.imported += result.imported;
    total.skipped += result.skipped;
    store.write(entries.slice(start + IMPORT_BATCH_SIZE));
  }
  return total;
}

/** The green message after an import, or null when there was nothing to report. */
export function describeImport({ imported, skipped }: ImportResult): string | null {
  if (imported === 0 && skipped === 0) return null;
  const parts = [
    `${imported} Prüfung${imported === 1 ? '' : 'en'} aus diesem Browser wurde${imported === 1 ? '' : 'n'} in die Datenbank übernommen.`,
  ];
  if (skipped > 0) parts.push(`${skipped} beschädigte Einträge wurden übersprungen.`);
  return parts.join(' ');
}

/**
 * Delayed saving: every key (for example one text field) has its own timer. A new change for the
 * same key restarts the timer, so only the last state is sent. flush() sends everything that is
 * still waiting, used when the page is left.
 */
export function createSaveQueue(delayMs: number) {
  const waiting = new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>();

  return {
    schedule(key: string, run: () => void) {
      const existing = waiting.get(key);
      if (existing) clearTimeout(existing.timer);
      const timer = setTimeout(() => {
        waiting.delete(key);
        run();
      }, delayMs);
      waiting.set(key, { timer, run });
    },
    flush() {
      const entries = Array.from(waiting.values());
      waiting.clear();
      entries.forEach((entry) => {
        clearTimeout(entry.timer);
        entry.run();
      });
    },
    pending() {
      return waiting.size;
    },
  };
}
