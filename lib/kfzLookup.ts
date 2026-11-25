import { kbaDatabase } from '../data/kbaDatabase';

export interface KfzData {
  plate: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  hsn: string;
  tsn: string;
  engine: string;
  tuvIntervalMonths: number;
  tuvDueDate: string;
  source: 'Lokale KBA-Demodaten';
}

type KfzLookupQuery = { plate?: string; vin?: string; hsn?: string; tsn?: string };

function normalizePlate(value: string): string {
  return value.toLocaleUpperCase('de-DE').replace(/[^A-ZÄÖÜ0-9]/g, '');
}

function validateQuery(query: KfzLookupQuery): { plate?: string; vin?: string; hsn?: string; tsn?: string } {
  const plate = query.plate?.trim();
  const vin = query.vin?.trim().toUpperCase();
  const hsn = query.hsn?.trim().toUpperCase();
  const tsn = query.tsn?.trim().toUpperCase();
  const hasPlate = Boolean(plate);
  const hasVin = Boolean(vin);
  const hasHsnTsn = Boolean(hsn) && Boolean(tsn);
  if (Number(hasPlate) + Number(hasVin) + Number(hasHsnTsn) !== 1 || Boolean(hsn) !== Boolean(tsn)) {
    throw new Error('Bitte gib ein Kennzeichen, eine FIN oder HSN und TSN gemeinsam ein.');
  }
  if (plate && normalizePlate(plate).length < 4) {
    throw new Error('Das Kennzeichen ist zu kurz oder ungültig.');
  }
  if (vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    throw new Error('Die Fahrzeug-Identifizierungsnummer muss aus 17 gültigen Zeichen bestehen.');
  }
  if (hsn && !/^\d{4}$/.test(hsn)) throw new Error('Die HSN muss aus vier Ziffern bestehen.');
  if (tsn && !/^[A-Z0-9]{3}$/.test(tsn)) throw new Error('Die TSN muss aus drei Buchstaben oder Ziffern bestehen.');
  return { plate, vin, hsn, tsn };
}

export function lookupKfzData(input: KfzLookupQuery): KfzData | null {
  const query = validateQuery(input);
  const vehicle = kbaDatabase.find((item) => {
    if (query.plate) return item.registrations.some((registration) => normalizePlate(registration.plate) === normalizePlate(query.plate!));
    if (query.vin) return item.registrations.some((registration) => registration.vin === query.vin);
    return item.hsn === query.hsn && item.tsn === query.tsn;
  });
  if (!vehicle) return null;

  const registration = vehicle.registrations.find((item) =>
    query.plate
      ? normalizePlate(item.plate) === normalizePlate(query.plate)
      : query.vin
        ? item.vin === query.vin
        : false,
  );
  return {
    plate: registration?.plate ?? query.plate?.toLocaleUpperCase('de-DE') ?? '',
    vin: registration?.vin ?? query.vin ?? '',
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    hsn: vehicle.hsn,
    tsn: vehicle.tsn,
    engine: vehicle.engine,
    tuvIntervalMonths: vehicle.tuvIntervalMonths,
    tuvDueDate: registration?.tuvDueDate ?? '',
    source: 'Lokale KBA-Demodaten',
  };
}
