/**
 * CSV import of customers and vehicles (from Excel or another workshop program).
 * Pure functions only: the browser uses them for the preview, the server runs them again before saving.
 */

export const IMPORT_FIELDS = [
  'name',
  'firstName',
  'lastName',
  'phone',
  'email',
  'street',
  'zip',
  'city',
  'notes',
  'plate',
  'make',
  'model',
  'vin',
  'hsn',
  'tsn',
  'year',
  'huDueDate',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Column index in the file for each field the user wants to import. */
export type ColumnMapping = Partial<Record<ImportField, number>>;

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: 'Name (vollständig / Firma)',
  firstName: 'Vorname',
  lastName: 'Nachname',
  phone: 'Telefon',
  email: 'E-Mail',
  street: 'Straße',
  zip: 'PLZ',
  city: 'Ort',
  notes: 'Notizen',
  plate: 'Kennzeichen',
  make: 'Marke',
  model: 'Modell',
  vin: 'FIN / VIN',
  hsn: 'HSN',
  tsn: 'TSN',
  year: 'Baujahr / EZ',
  huDueDate: 'HU fällig',
};

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** Database column limits (db/schema.ts), so a too long value is a row error instead of a failed import. */
const MAX_LENGTH: Partial<Record<ImportField, number>> = {
  name: 200,
  phone: 40,
  email: 320,
  street: 200,
  zip: 20,
  city: 120,
  plate: 20,
  make: 100,
  model: 150,
};

// ---------------------------------------------------------------------------
// Parsing

/**
 * File bytes to text. Excel in Germany often saves CSV as Windows-1252 ("ANSI"), not UTF-8,
 * so umlauts would break; when the bytes are not valid UTF-8 we read them as Windows-1252.
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Picks the separator that appears most often outside quotes in the first line. */
export function detectSeparator(text: string): string {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const counts = new Map<string, number>([[';', 0], [',', 0], ['\t', 0]]);
  let inQuotes = false;
  for (const char of firstLine) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && counts.has(char)) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let best = ';';
  let bestCount = 0;
  counts.forEach((count, separator) => {
    if (count > bestCount) {
      best = separator;
      bestCount = count;
    }
  });
  return best;
}

/**
 * Splits CSV text into rows of cells (RFC 4180 with any separator): quoted cells may contain the separator,
 * doubled quotes and line breaks. A BOM is removed and completely empty lines are skipped.
 */
export function parseCsv(text: string, separator = detectSeparator(text)): string[][] {
  const source = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const endRow = () => {
    row.push(cell);
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    row = [];
    cell = '';
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === '') {
      inQuotes = true;
    } else if (char === separator) {
      row.push(cell);
      cell = '';
    } else if (char === '\r') {
      if (source[index + 1] === '\n') index += 1;
      endRow();
    } else if (char === '\n') {
      endRow();
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

// ---------------------------------------------------------------------------
// Header mapping

const HEADER_SYNONYMS: Record<ImportField, string[]> = {
  name: ['name', 'kunde', 'kundenname', 'firma', 'firmenname', 'customer', 'customername', 'fullname'],
  firstName: ['vorname', 'firstname'],
  lastName: ['nachname', 'familienname', 'lastname', 'surname'],
  phone: ['telefon', 'tel', 'telefonnummer', 'mobil', 'handy', 'mobilnummer', 'phone', 'mobile', 'telefonmobil'],
  email: ['email', 'mail', 'emailadresse'],
  street: ['strasse', 'str', 'strassehausnummer', 'adresse', 'anschrift', 'street', 'address'],
  zip: ['plz', 'postleitzahl', 'zip', 'zipcode', 'postalcode'],
  city: ['ort', 'stadt', 'wohnort', 'city'],
  notes: ['notiz', 'notizen', 'bemerkung', 'bemerkungen', 'hinweis', 'notes', 'kommentar'],
  plate: ['kennzeichen', 'kfzkennzeichen', 'amtlicheskennzeichen', 'kfz', 'plate', 'licenseplate'],
  make: ['marke', 'hersteller', 'fabrikat', 'make', 'brand'],
  model: ['modell', 'typ', 'model', 'handelsbezeichnung'],
  vin: ['fin', 'vin', 'fahrgestellnummer', 'fahrzeugidentnummer', 'fahrzeugidentifikationsnummer'],
  hsn: ['hsn', 'herstellerschluessel', 'herstellerschluesselnummer', 'zu2'],
  tsn: ['tsn', 'typschluessel', 'typschluesselnummer', 'zu3'],
  year: ['baujahr', 'ez', 'erstzulassung', 'jahr', 'year'],
  huDueDate: ['hu', 'tuev', 'tuv', 'hufaellig', 'tuevfaellig', 'naechstehu', 'hudatum', 'hutermin', 'hutuev', 'huau'],
};

/** "Straße / Nr." -> "strassenr", "TÜV fällig" -> "tuevfaellig". */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

/** Guesses which column holds which field. Each column is used at most once; the first match wins. */
export function guessMapping(headers: readonly string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const normalized = headers.map(normalizeHeader);

  for (const field of IMPORT_FIELDS) {
    const synonyms = HEADER_SYNONYMS[field];
    const index = normalized.findIndex((header, position) => !used.has(position) && synonyms.includes(header));
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }
  return mapping;
}

/** Checks a mapping that came from the client: known fields, integer column indexes inside the header. */
export function parseMapping(value: unknown, columnCount: number): ColumnMapping | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const mapping: ColumnMapping = {};
  for (const [key, index] of Object.entries(value)) {
    if (!(IMPORT_FIELDS as readonly string[]).includes(key)) return null;
    if (index === null || index === undefined) continue;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= columnCount) return null;
    mapping[key as ImportField] = index;
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// Values

/** Accepts 31.12.2026, 31.12.26, 2026-12-31, 12/2026, 12.2026 and 12/26 (HU sticker style = end of month). */
export function parseImportDate(value: string): string | null {
  const text = value.trim();
  if (!text) return null;

  let year: number;
  let month: number;
  let day: number | null;

  let match = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(text);
  if (match) {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  } else if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text))) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else if ((match = /^(\d{1,2})[./](\d{2}|\d{4})$/.exec(text))) {
    month = Number(match[1]);
    year = Number(match[2]);
    day = null;
  } else {
    return null;
  }

  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || year < 1900 || year > 2200) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const finalDay = day ?? lastDay;
  if (finalDay < 1 || finalDay > lastDay) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(finalDay).padStart(2, '0')}`;
}

/** "2014", "03.2014", "15.03.2014" -> 2014. */
export function parseImportYear(value: string): number | null {
  const match = /(\d{4})\s*$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1900 && year <= 2100 ? year : null;
}

/** Plates are compared without spaces and dashes, case-insensitive: "M-AB 123" equals "m ab123". */
export function plateKey(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, '');
}

/** Customer identity for duplicates: e-mail if present, otherwise name plus phone digits. */
export function customerKey(customer: { name: string; email?: string | null; phone?: string | null }): string {
  const email = customer.email?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const name = customer.name.trim().toLowerCase().replace(/\s+/g, ' ');
  const phone = (customer.phone ?? '').replace(/\D/g, '');
  return `name:${name}|${phone}`;
}

// ---------------------------------------------------------------------------
// Rows

export type ImportCustomer = {
  name: string;
  phone: string;
  email: string;
  street: string;
  zip: string;
  city: string;
  notes: string;
};

export type ImportVehicle = {
  plate: string;
  make: string;
  model: string;
  vin: string | null;
  hsn: string | null;
  tsn: string | null;
  year: number | null;
  huDueDate: string;
};

export type ImportRow = {
  /** Line number in the file (header = 1), so the user can find the row in Excel. */
  line: number;
  customer: ImportCustomer | null;
  vehicle: ImportVehicle | null;
  errors: string[];
  warnings: string[];
};

function cellOf(cells: readonly string[], mapping: ColumnMapping, field: ImportField): string {
  const index = mapping[field];
  if (index === undefined) return '';
  return (cells[index] ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Turns one data row into a customer and an optional vehicle.
 * Errors skip the whole row; warnings keep the customer but skip or shorten the vehicle data.
 */
export function buildImportRow(cells: readonly string[], mapping: ColumnMapping, line: number): ImportRow {
  const get = (field: ImportField) => cellOf(cells, mapping, field);
  const errors: string[] = [];
  const warnings: string[] = [];

  const name = get('name') || [get('firstName'), get('lastName')].filter(Boolean).join(' ');
  if (!name) errors.push('Name fehlt.');

  const email = get('email');
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) errors.push(`E-Mail „${email}“ ist ungültig.`);

  const customer: ImportCustomer = {
    name,
    phone: get('phone'),
    email,
    street: get('street'),
    zip: get('zip'),
    city: get('city'),
    notes: get('notes'),
  };
  for (const field of ['name', 'phone', 'email', 'street', 'zip', 'city'] as const) {
    const max = MAX_LENGTH[field];
    if (max && customer[field].length > max) errors.push(`${IMPORT_FIELD_LABELS[field]} ist länger als ${max} Zeichen.`);
  }

  let vehicle: ImportVehicle | null = null;
  const plate = get('plate');
  const vehicleDataPresent = ['plate', 'make', 'model', 'vin', 'hsn', 'tsn', 'huDueDate'].some(
    (field) => get(field as ImportField) !== '',
  );

  if (plate) {
    const vehicleErrors: string[] = [];
    const huDueDate = parseImportDate(get('huDueDate'));
    if (!get('huDueDate')) vehicleErrors.push('HU-Datum fehlt');
    else if (!huDueDate) vehicleErrors.push(`HU-Datum „${get('huDueDate')}“ nicht erkannt`);

    const make = get('make');
    if (!make) vehicleErrors.push('Marke fehlt');

    for (const field of ['plate', 'make', 'model'] as const) {
      const max = MAX_LENGTH[field];
      if (max && get(field).length > max) vehicleErrors.push(`${IMPORT_FIELD_LABELS[field]} zu lang`);
    }

    const vin = get('vin').toUpperCase().replace(/\s/g, '');
    const hsn = get('hsn').replace(/\s/g, '');
    const tsn = get('tsn').toUpperCase().replace(/\s/g, '');
    const optional: { vin: string | null; hsn: string | null; tsn: string | null } = { vin: null, hsn: null, tsn: null };
    if (vin) {
      if (/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) optional.vin = vin;
      else warnings.push(`FIN „${vin}“ ignoriert (keine 17 gültigen Zeichen).`);
    }
    if (hsn) {
      if (/^\d{4}$/.test(hsn)) optional.hsn = hsn;
      else warnings.push(`HSN „${hsn}“ ignoriert (4 Ziffern erwartet).`);
    }
    if (tsn) {
      if (/^[A-Z0-9]{3}$/.test(tsn)) optional.tsn = tsn;
      else warnings.push(`TSN „${tsn}“ ignoriert (3 Zeichen erwartet).`);
    }
    const yearText = get('year');
    const year = yearText ? parseImportYear(yearText) : null;
    if (yearText && year === null) warnings.push(`Baujahr „${yearText}“ ignoriert.`);

    if (vehicleErrors.length > 0) {
      warnings.push(`Fahrzeug ${plate} wird nicht übernommen: ${vehicleErrors.join(', ')}.`);
    } else {
      vehicle = { plate, make, model: get('model'), ...optional, year, huDueDate: huDueDate as string };
    }
  } else if (vehicleDataPresent) {
    warnings.push('Fahrzeugdaten ohne Kennzeichen werden nicht übernommen.');
  }

  return {
    line,
    customer: errors.length === 0 ? customer : null,
    vehicle: errors.length === 0 ? vehicle : null,
    errors,
    warnings,
  };
}

export type ImportPreview = {
  headers: string[];
  rows: ImportRow[];
  error: string | null;
};

/** Parses a whole file with a mapping. The first non-empty line is the header. */
export function buildImportPreview(text: string, mapping?: ColumnMapping): ImportPreview & { mapping: ColumnMapping } {
  const table = parseCsv(text);
  const headers = (table[0] ?? []).map((header) => header.trim());
  const finalMapping = mapping ?? guessMapping(headers);
  if (headers.length === 0) {
    return { headers, rows: [], mapping: finalMapping, error: 'Die Datei ist leer.' };
  }
  const dataRows = table.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return {
      headers,
      rows: [],
      mapping: finalMapping,
      error: `Die Datei hat ${dataRows.length} Zeilen. Bitte höchstens ${MAX_IMPORT_ROWS} Zeilen pro Import.`,
    };
  }
  if (finalMapping.name === undefined && finalMapping.lastName === undefined && finalMapping.firstName === undefined) {
    return { headers, rows: [], mapping: finalMapping, error: 'Bitte eine Spalte für den Namen zuordnen.' };
  }
  const rows = dataRows.map((cells, index) => buildImportRow(cells, finalMapping, index + 2));
  return { headers, rows, mapping: finalMapping, error: null };
}

// ---------------------------------------------------------------------------
// Plan: what will really be created, given what the workshop already has

export type ImportPlanCustomer = {
  key: string;
  /** Set when the customer already exists: vehicles are attached to it, the customer itself is not changed. */
  existingId: string | null;
  data: ImportCustomer;
  vehicles: ImportVehicle[];
};

export type ImportPlan = {
  customers: ImportPlanCustomer[];
  newCustomers: number;
  existingCustomers: number;
  newVehicles: number;
  skippedVehicles: number;
  invalidRows: number;
};

export type ExistingData = {
  customers: { id: string; name: string; email: string | null; phone: string | null }[];
  plates: string[];
};

/**
 * Groups rows by customer (one customer may have several cars in several rows), matches them with existing
 * customers, and drops vehicles whose plate already exists in the workshop or earlier in the file.
 */
export function planImport(rows: readonly ImportRow[], existing: ExistingData): ImportPlan {
  const existingByKey = new Map(existing.customers.map((customer) => [customerKey(customer), customer.id]));
  const knownPlates = new Set(existing.plates.map(plateKey));
  const byKey = new Map<string, ImportPlanCustomer>();
  let skippedVehicles = 0;
  let invalidRows = 0;

  for (const row of rows) {
    if (!row.customer) {
      invalidRows += 1;
      continue;
    }
    const key = customerKey(row.customer);
    let entry = byKey.get(key);
    if (!entry) {
      entry = { key, existingId: existingByKey.get(key) ?? null, data: row.customer, vehicles: [] };
      byKey.set(key, entry);
    }
    if (row.vehicle) {
      const plate = plateKey(row.vehicle.plate);
      if (knownPlates.has(plate)) {
        skippedVehicles += 1;
      } else {
        knownPlates.add(plate);
        entry.vehicles.push(row.vehicle);
      }
    }
  }

  const customers = Array.from(byKey.values());
  return {
    customers,
    newCustomers: customers.filter((customer) => customer.existingId === null).length,
    existingCustomers: customers.filter((customer) => customer.existingId !== null).length,
    newVehicles: customers.reduce((sum, customer) => sum + customer.vehicles.length, 0),
    skippedVehicles,
    invalidRows,
  };
}
