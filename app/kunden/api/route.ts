import { NextResponse } from 'next/server';
import {
  createCustomer,
  createVehicle,
  deleteCustomer,
  deleteVehicle,
  getArchivedCustomers,
  getArchivedVehicles,
  getCustomers,
  getVehicles,
  markReminderSent,
  recordReminderConsent,
  recordReminderOptOut,
  restoreCustomer,
  restoreVehicle,
  updateCustomer,
  updateVehicle,
} from '../../../lib/db/customers';
import { ForbiddenError, requireRole } from '../../../lib/requireRole';
import { NoTenantError } from '../../../lib/session';
import type { CustomerInput, VehicleInput } from '../../../lib/customers';
import { isConsentSource } from '../../../lib/reminder-consent';

class ValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${label} darf nicht leer sein.`);
  }
  return value.trim();
}

function requiredString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new ValidationError(`${label} ist ungültig.`);
  return value.trim();
}

function optionalEmail(record: Record<string, unknown>): string {
  const value = record.email;
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ValidationError('Die E-Mail-Adresse ist ungültig.');

  const email = value.trim();
  if (email && !email.includes('@')) {
    throw new ValidationError('Bitte gib eine gültige E-Mail-Adresse mit @-Zeichen ein.');
  }
  return email;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ValidationError(`Das Feld „${key}“ ist ungültig.`);
  return value.trim() || undefined;
}

function optionalInteger(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(`Das Feld „${key}“ muss eine ganze Zahl sein.`);
  }
  return value;
}

function requiredId(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)) {
    throw new ValidationError('Die Kennung ist ungültig.');
  }
  return value;
}

function isValidDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseCustomerInput(value: unknown): CustomerInput {
  if (!isRecord(value)) throw new ValidationError('Ungültige Kundendaten.');

  return {
    name: requiredText(value, 'name', 'Der Name'),
    phone: requiredString(value, 'phone', 'Die Telefonnummer'),
    email: optionalEmail(value),
    notes: optionalString(value, 'notes'),
  };
}

function parseVehicleInput(value: unknown): VehicleInput {
  if (!isRecord(value)) throw new ValidationError('Ungültige Fahrzeugdaten.');

  const tuvDueDate = requiredText(value, 'tuvDueDate', 'Das HU-Fälligkeitsdatum');
  if (!isValidDateString(tuvDueDate)) {
    throw new ValidationError('Das HU-Fälligkeitsdatum muss im Format YYYY-MM-DD angegeben werden.');
  }

  const year = optionalInteger(value, 'year');
  const tuvIntervalMonths = optionalInteger(value, 'tuvIntervalMonths');
  if (tuvIntervalMonths !== undefined && tuvIntervalMonths <= 0) {
    throw new ValidationError('Das HU-Prüfintervall muss größer als 0 sein.');
  }

  return {
    customerId: requiredId(value, 'customerId'),
    make: requiredText(value, 'make', 'Die Marke'),
    plate: requiredText(value, 'plate', 'Das Kennzeichen'),
    tuvDueDate,
    year,
    hsn: optionalString(value, 'hsn'),
    tsn: optionalString(value, 'tsn'),
    vin: optionalString(value, 'vin'),
    engine: optionalString(value, 'engine'),
    tuvIntervalMonths,
  };
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof NoTenantError) {
    return NextResponse.json({ ok: false, error: 'Keiner Werkstatt zugeordnet.' }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  console.error('Kunden- und Fahrzeugdaten konnten nicht verarbeitet werden.', error);
  return NextResponse.json({ ok: false, error: 'Kunden- und Fahrzeugdaten konnten nicht verarbeitet werden.' }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const { tenantId } = await requireRole(['owner', 'office', 'mechanic']);
    const archived = new URL(request.url).searchParams.get('archived') === 'true';
    const [customers, vehicles] = await Promise.all(
      archived
        ? [getArchivedCustomers(tenantId), getArchivedVehicles(tenantId)]
        : [getCustomers(tenantId), getVehicles(tenantId)],
    );

    return NextResponse.json({ ok: true, customers, vehicles });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const action = new URL(request.url).searchParams.get('action');
  const supportedActions = [
    'createCustomer',
    'updateCustomer',
    'deleteCustomer',
    'restoreCustomer',
    'createVehicle',
    'updateVehicle',
    'deleteVehicle',
    'restoreVehicle',
    'markReminderSent',
    'recordReminderConsent',
    'recordReminderOptOut',
  ];
  if (!action || !supportedActions.includes(action)) {
    return NextResponse.json({ ok: false, error: 'Unbekannte Aktion.' }, { status: 400 });
  }

  try {
    const { tenantId } = await requireRole(['owner', 'office']);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Ungültige JSON-Anfrage.');
    }

    if (!isRecord(body)) throw new ValidationError('Ungültige Anfrage.');

    switch (action) {
      case 'createCustomer': {
        const customer = await createCustomer(tenantId, parseCustomerInput(body));
        return NextResponse.json({ ok: true, customer });
      }
      case 'updateCustomer': {
        const id = requiredId(body, 'id');
        const customer = await updateCustomer(tenantId, id, parseCustomerInput(body));
        return NextResponse.json({ ok: true, customer });
      }
      case 'deleteCustomer': {
        await deleteCustomer(tenantId, requiredId(body, 'id'));
        return NextResponse.json({ ok: true });
      }
      case 'restoreCustomer': {
        const restored = await restoreCustomer(tenantId, requiredId(body, 'id'));
        if (!restored) {
          return NextResponse.json({ ok: false, error: 'Der archivierte Kunde wurde nicht gefunden.' }, { status: 404 });
        }
        return NextResponse.json({ ok: true });
      }
      case 'createVehicle': {
        const vehicle = await createVehicle(tenantId, parseVehicleInput(body));
        return NextResponse.json({ ok: true, vehicle });
      }
      case 'updateVehicle': {
        const id = requiredId(body, 'id');
        const vehicle = await updateVehicle(tenantId, id, parseVehicleInput(body));
        return NextResponse.json({ ok: true, vehicle });
      }
      case 'deleteVehicle': {
        await deleteVehicle(tenantId, requiredId(body, 'id'));
        return NextResponse.json({ ok: true });
      }
      case 'restoreVehicle': {
        const restored = await restoreVehicle(tenantId, requiredId(body, 'id'));
        if (!restored) {
          return NextResponse.json({ ok: false, error: 'Das archivierte Fahrzeug wurde nicht gefunden.' }, { status: 404 });
        }
        return NextResponse.json({ ok: true });
      }
      case 'markReminderSent': {
        await markReminderSent(tenantId, requiredId(body, 'vehicleId'));
        return NextResponse.json({ ok: true });
      }
      case 'recordReminderConsent': {
        const source = body.source;
        if (!isConsentSource(source)) throw new ValidationError('Bitte gib an, wie die Einwilligung erteilt wurde.');
        const recorded = await recordReminderConsent(tenantId, requiredId(body, 'customerId'), source);
        if (!recorded) {
          return NextResponse.json({ ok: false, error: 'Der Kunde wurde nicht gefunden.' }, { status: 404 });
        }
        return NextResponse.json({ ok: true });
      }
      case 'recordReminderOptOut': {
        const recorded = await recordReminderOptOut(tenantId, requiredId(body, 'customerId'));
        if (!recorded) {
          return NextResponse.json({ ok: false, error: 'Der Kunde wurde nicht gefunden.' }, { status: 404 });
        }
        return NextResponse.json({ ok: true });
      }
      default:
        throw new ValidationError('Unbekannte Aktion.');
    }
  } catch (error) {
    return errorResponse(error);
  }
}
