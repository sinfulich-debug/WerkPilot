// Pure parsing of OCR text from a German Zulassungsbescheinigung Teil I (Fahrzeugschein).
// Field names follow the EU harmonised layout: E = VIN, 2.1 = HSN, 2.2 = TSN, B = first registration.
// OCR output is noisy, so every value is validated and left out when unsure. The UI shows the
// result to a person who confirms it; nothing here is saved by itself.

export type FahrzeugscheinFields = {
  vin?: string;
  hsn?: string;
  tsn?: string;
  /** First registration as YYYY-MM-DD. */
  firstRegistration?: string;
  /** Year of the first registration, used as the vehicle's year. */
  year?: number;
};

// A VIN never contains I, O or Q. OCR often reads 0 as O and 1 as I.
const VIN_FIX: Record<string, string> = { O: '0', Q: '0', I: '1' };
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export function normalizeVin(raw: string): string | null {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length !== 17) return null;
  const fixed = cleaned.replace(/[OQI]/g, (char) => VIN_FIX[char]);
  if (!VIN_PATTERN.test(fixed)) return null;
  // Real VINs mix letters and digits; a run of only letters or only digits is noise.
  if (!/[A-Z]/.test(fixed) || !/\d/.test(fixed)) return null;
  // The serial number at the end is numeric on practically every VIN; ordinary words are not.
  if (!/\d{4}$/.test(fixed)) return null;
  return fixed;
}

function findVin(text: string): string | undefined {
  // 1. A single 17-character token, e.g. "WVWZZZ1KZ8W123456".
  for (const token of text.toUpperCase().split(/[\s:;,|/]+/)) {
    const vin = normalizeVin(token);
    if (vin) return vin;
  }
  // 2. A VIN broken by spaces or dashes: join neighbouring pieces that add up to exactly 17 characters,
  // so a field label such as "E" in front is never glued on.
  for (const line of text.split(/\r?\n/)) {
    const pieces = line
      .toUpperCase()
      .split(/[\s-]+/)
      .map((piece) => piece.replace(/[^A-Z0-9]/g, ''))
      .filter(Boolean);
    for (let start = 0; start < pieces.length; start += 1) {
      let joined = '';
      for (let end = start; end < pieces.length && joined.length < 17; end += 1) {
        joined += pieces[end];
        if (joined.length === 17) {
          const vin = normalizeVin(joined);
          if (vin) return vin;
        }
      }
    }
  }
  return undefined;
}

const DIGIT_FIX: Record<string, string> = { O: '0', Q: '0', I: '1', L: '1' };

function toDigits(raw: string): string | null {
  const fixed = raw.toUpperCase().replace(/[OQIL]/g, (char) => DIGIT_FIX[char]);
  return /^\d{4}$/.test(fixed) ? fixed : null;
}

function findHsnTsn(text: string): { hsn?: string; tsn?: string } {
  const upper = text.toUpperCase();

  // Labelled fields: "2.1 0603" and "2.2 BDK".
  const hsnLabelled = /\b2\s*[.,]\s*1\b[^A-Z0-9]{0,12}([A-Z0-9]{4})\b/.exec(upper);
  const tsnLabelled = /\b2\s*[.,]\s*2\b[^A-Z0-9]{0,12}([A-Z0-9]{3})\b/.exec(upper);
  const hsn = hsnLabelled ? toDigits(hsnLabelled[1]) : null;
  const tsn = tsnLabelled ? tsnLabelled[1] : null;
  if (hsn && tsn) return { hsn, tsn };

  // Combined line: "Schlüsselnummer zu 2 und 3: 0603 BDK" or "0603/BDK".
  const combined = /(?:ZU\s*2\s*UND\s*3|SCHL[ÜU]SSELNUMMER)[^\n]*?\b([A-Z0-9]{4})\s*[\/\-\s]\s*([A-Z0-9]{3})\b/.exec(upper);
  if (combined) {
    const combinedHsn = toDigits(combined[1]);
    if (combinedHsn) return { hsn: combinedHsn, tsn: combined[2] };
  }

  return { ...(hsn ? { hsn } : {}), ...(tsn ? { tsn } : {}) };
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function findFirstRegistration(text: string, now: Date): string | undefined {
  // Field B: "B 12.03.2015" or "Datum der Erstzulassung" followed by the date.
  const match = /(?:(?:^|[^A-Za-z0-9])B(?![A-Za-z0-9])|ERSTZULASSUNG)[^\d]{0,60}(\d{1,2})\s*[.,]\s*(\d{1,2})\s*[.,]\s*(\d{4})/i.exec(text);
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year < 1900 || !isRealDate(year, month, day)) return undefined;
  const iso = `${year}-${pad(month)}-${pad(day)}`;
  const today = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  return iso > today ? undefined : iso;
}

/** Reads what it can from OCR text; fields it cannot read with confidence are left out. */
export function parseFahrzeugscheinText(text: string, now: Date = new Date()): FahrzeugscheinFields {
  const vin = findVin(text);
  const { hsn, tsn } = findHsnTsn(text);
  const firstRegistration = findFirstRegistration(text, now);
  return {
    ...(vin ? { vin } : {}),
    ...(hsn ? { hsn } : {}),
    ...(tsn ? { tsn } : {}),
    ...(firstRegistration ? { firstRegistration, year: Number(firstRegistration.slice(0, 4)) } : {}),
  };
}
