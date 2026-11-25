/**
 * Pure helpers for the vehicle inspection (DVI / Annahmeprotokoll). No database access here, so the
 * same rules run in the browser (before uploading) and on the server (before saving).
 */

export type InspectionStatus = 'gruen' | 'gelb' | 'rot';
export const INSPECTION_STATUSES: readonly InspectionStatus[] = ['gruen', 'gelb', 'rot'];

/** Max. length of a stored photo (data URL of a compressed JPEG), about 600 KB of image data. */
export const MAX_INSPECTION_PHOTO_CHARS = 800_000;
export const MAX_INSPECTION_NOTE_LENGTH = 2000;
export const MAX_INSPECTION_LABEL_LENGTH = 120;
export const MAX_INSPECTION_ITEMS = 50;
/** At most this many inspections are read from the old browser data. */
export const MAX_IMPORT_INSPECTIONS = 100;
/** The browser sends them in small batches: each one may carry several photos. */
export const IMPORT_BATCH_SIZE = 5;
export const JPEG_DATA_URL_PREFIX = 'data:image/jpeg;base64,';

/** Checklist of a new inspection (the same three points as before). */
export const DEFAULT_CHECKLIST: readonly string[] = ['Bremsanlage', 'Bereifung', 'Beleuchtung'];

export type InspectionItem = {
  id: string;
  label: string;
  status: InspectionStatus;
  note: string;
  /** The photo itself is loaded separately, only when it is shown. */
  hasPhoto: boolean;
};

export type Inspection = {
  id: string;
  customerName: string;
  vehicleLabel: string;
  plate: string;
  createdAt: string;
  items: InspectionItem[];
};

export type InspectionHeader = { customerName: string; vehicleLabel: string; plate: string };
export type ItemChange = { status?: InspectionStatus; note?: string };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

const HEADER_LIMITS: Record<keyof InspectionHeader, { max: number; label: string }> = {
  customerName: { max: 200, label: 'Der Kundenname' },
  vehicleLabel: { max: 200, label: 'Das Fahrzeug' },
  plate: { max: 20, label: 'Das Kennzeichen' },
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isInspectionStatus(value: unknown): value is InspectionStatus {
  return typeof value === 'string' && (INSPECTION_STATUSES as readonly string[]).includes(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Customer, vehicle and plate. All optional (empty while the form is filled in), but limited in length. */
export function parseInspectionHeader(body: unknown): ParseResult<InspectionHeader> {
  const source = isRecord(body) ? body : {};
  const result: InspectionHeader = { customerName: '', vehicleLabel: '', plate: '' };
  for (const key of Object.keys(HEADER_LIMITS) as Array<keyof InspectionHeader>) {
    const raw = source[key];
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      return { ok: false, message: `${HEADER_LIMITS[key].label} ist ungültig.` };
    }
    const value = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (value.length > HEADER_LIMITS[key].max) {
      return { ok: false, message: `${HEADER_LIMITS[key].label} darf höchstens ${HEADER_LIMITS[key].max} Zeichen lang sein.` };
    }
    result[key] = key === 'plate' ? value.toUpperCase() : value;
  }
  return { ok: true, value: result };
}

/** A change of one checklist item: status and/or note. At least one of them. */
export function parseItemChange(body: unknown): ParseResult<ItemChange> {
  if (!isRecord(body)) return { ok: false, message: 'Ungültige Anfrage.' };
  const change: ItemChange = {};
  if (body.status !== undefined) {
    if (!isInspectionStatus(body.status)) return { ok: false, message: 'Der Befund ist ungültig.' };
    change.status = body.status;
  }
  if (body.note !== undefined) {
    if (typeof body.note !== 'string') return { ok: false, message: 'Die Notiz ist ungültig.' };
    if (body.note.length > MAX_INSPECTION_NOTE_LENGTH) {
      return { ok: false, message: `Die Notiz darf höchstens ${MAX_INSPECTION_NOTE_LENGTH} Zeichen lang sein.` };
    }
    change.note = body.note;
  }
  if (change.status === undefined && change.note === undefined) {
    return { ok: false, message: 'Es wurde nichts geändert.' };
  }
  return { ok: true, value: change };
}

/** Only compressed JPEG data URLs of limited size (the same rule the database checks). */
export function parsePhotoDataUrl(value: unknown): ParseResult<string> {
  if (typeof value !== 'string' || !value.startsWith(JPEG_DATA_URL_PREFIX)) {
    return { ok: false, message: 'Bitte ein Foto im JPEG-Format hochladen.' };
  }
  if (value.length > MAX_INSPECTION_PHOTO_CHARS) {
    return { ok: false, message: 'Das Foto ist zu groß. Bitte ein kleineres Bild wählen.' };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value.slice(JPEG_DATA_URL_PREFIX.length))) {
    return { ok: false, message: 'Das Foto ist beschädigt.' };
  }
  return { ok: true, value };
}

export type ImportedInspection = InspectionHeader & {
  items: Array<{ label: string; status: InspectionStatus; note: string; photo: string | null }>;
};

/**
 * Reads the inspections that were kept in the browser (localStorage key "werkpilot-inspections")
 * so they can be moved into the database once. Broken entries are skipped instead of failing the
 * whole import; photos that the database would refuse are dropped (the finding text stays).
 * The demo entry that every browser got by default ("pruefung-1") is not imported.
 */
export function parseLegacyInspections(value: unknown): { inspections: ImportedInspection[]; skipped: number } {
  if (!Array.isArray(value)) return { inspections: [], skipped: 0 };
  const inspections: ImportedInspection[] = [];
  let skipped = 0;

  for (const entry of value.slice(0, MAX_IMPORT_INSPECTIONS)) {
    if (!isRecord(entry) || !Array.isArray(entry.items)) {
      skipped += 1;
      continue;
    }
    if (entry.id === 'pruefung-1') continue;
    const header = parseInspectionHeader({
      customerName: typeof entry.customer === 'string' ? entry.customer.slice(0, 200) : '',
      vehicleLabel: typeof entry.vehicle === 'string' ? entry.vehicle.slice(0, 200) : '',
      plate: typeof entry.plate === 'string' ? entry.plate.slice(0, 20) : '',
    });
    if (!header.ok) {
      skipped += 1;
      continue;
    }
    const items = entry.items.slice(0, MAX_INSPECTION_ITEMS).flatMap((raw) => {
      if (!isRecord(raw) || typeof raw.label !== 'string' || !raw.label.trim()) return [];
      const photo = parsePhotoDataUrl(raw.photo);
      return [{
        label: raw.label.trim().slice(0, MAX_INSPECTION_LABEL_LENGTH),
        status: isInspectionStatus(raw.status) ? raw.status : 'gruen',
        note: typeof raw.note === 'string' ? raw.note.slice(0, MAX_INSPECTION_NOTE_LENGTH) : '',
        photo: photo.ok ? photo.value : null,
      }];
    });
    if (items.length === 0) {
      skipped += 1;
      continue;
    }
    inspections.push({ ...header.value, items });
  }
  skipped += Math.max(0, value.length - MAX_IMPORT_INSPECTIONS);
  return { inspections, skipped };
}
