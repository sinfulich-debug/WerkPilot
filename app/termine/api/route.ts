import { NextResponse } from 'next/server';
import {
  AppointmentConflictError,
  getAppointmentMechanics,
  InvalidAppointmentMechanicError,
  createAppointment,
  deleteAppointment,
  getAppointments,
  updateAppointment,
} from '../../../lib/db/appointments';
import { ForbiddenError, requireRole } from '../../../lib/requireRole';
import { NoTenantError } from '../../../lib/session';
import type { AppointmentForm, AppointmentMechanic } from '../../../lib/appointments';

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

function optionalText(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ValidationError(`Das Feld „${key}“ ist ungültig.`);
  return value.trim() || undefined;
}

function optionalId(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ValidationError(`Die Kennung „${key}“ ist ungültig.`);
  }
  return value;
}

function optionalInteger(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(`Das Feld „${key}“ muss eine ganze Zahl sein.`);
  }
  return value;
}

function isValidDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseAppointmentForm(value: unknown): AppointmentForm {
  if (!isRecord(value)) throw new ValidationError('Ungültige Termindaten.');

  const date = requiredText(value, 'date', 'Das Datum');
  if (!isValidDateString(date)) {
    throw new ValidationError('Das Datum muss im Format YYYY-MM-DD angegeben werden.');
  }

  const time = requiredText(value, 'time', 'Die Uhrzeit');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new ValidationError('Die Uhrzeit muss im Format HH:MM angegeben werden.');
  }

  const status = value.status;
  if (status !== 'Bestätigt' && status !== 'Ausstehend' && status !== 'Abgeschlossen') {
    throw new ValidationError('Der Terminstatus ist ungültig.');
  }

  const tuvIntervalMonths = optionalInteger(value, 'tuvIntervalMonths');
  if (tuvIntervalMonths !== undefined && tuvIntervalMonths <= 0) {
    throw new ValidationError('Das HU-Prüfintervall muss größer als 0 sein.');
  }

  const durationMinutes = optionalInteger(value, 'durationMinutes');
  if (durationMinutes === undefined || durationMinutes < 5 || durationMinutes > 1440) {
    throw new ValidationError('Die Dauer muss zwischen 5 und 1.440 Minuten liegen.');
  }

  const tuvDueDate = optionalText(value, 'tuvDueDate');
  if (tuvDueDate !== undefined && !isValidDateString(tuvDueDate)) {
    throw new ValidationError('Das HU-Fälligkeitsdatum muss im Format YYYY-MM-DD angegeben werden.');
  }

  const reason = value.reason;
  if (reason !== undefined && reason !== null && typeof reason !== 'string') {
    throw new ValidationError('Der Servicegrund ist ungültig.');
  }

  const bay = requiredText(value, 'bay', 'Der Arbeitsplatz');
  if (bay.length > 120) {
    throw new ValidationError('Der Arbeitsplatz darf höchstens 120 Zeichen lang sein.');
  }

  return {
    customer: requiredText(value, 'customer', 'Der Kunde'),
    vehicle: requiredText(value, 'vehicle', 'Das Fahrzeug'),
    plate: requiredText(value, 'plate', 'Das Kennzeichen'),
    durationMinutes,
    bay,
    mechanicId: optionalId(value, 'mechanicId'),
    customerId: optionalId(value, 'customerId'),
    vehicleId: optionalId(value, 'vehicleId'),
    vehicleYear: optionalInteger(value, 'vehicleYear'),
    hsn: optionalText(value, 'hsn'),
    tsn: optionalText(value, 'tsn'),
    vin: optionalText(value, 'vin'),
    engine: optionalText(value, 'engine'),
    tuvIntervalMonths,
    tuvDueDate,
    reason: typeof reason === 'string' ? reason.trim() : '',
    date,
    time,
    status,
  };
}

function requiredId(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
  ) {
    throw new ValidationError('Die Kennung ist ungültig.');
  }
  return value;
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
  if (error instanceof InvalidAppointmentMechanicError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  if (error instanceof AppointmentConflictError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
  }

  console.error('Termine konnten nicht verarbeitet werden.', error);
  return NextResponse.json({ ok: false, error: 'Termine konnten nicht verarbeitet werden.' }, { status: 500 });
}

export async function GET() {
  try {
    const { tenantId } = await requireRole(['owner', 'office', 'mechanic']);
    const [appointments, mechanics]: [Awaited<ReturnType<typeof getAppointments>>, AppointmentMechanic[]] =
      await Promise.all([getAppointments(tenantId), getAppointmentMechanics(tenantId)]);
    return NextResponse.json({ ok: true, appointments, mechanics });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const action = new URL(request.url).searchParams.get('action');
  if (!action || !['createAppointment', 'updateAppointment', 'deleteAppointment'].includes(action)) {
    return NextResponse.json({ ok: false, error: 'Unbekannte Aktion.' }, { status: 400 });
  }

  try {
    const { tenantId } = await requireRole(['owner', 'office', 'mechanic']);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Ungültige JSON-Anfrage.');
    }

    if (!isRecord(body)) throw new ValidationError('Ungültige Anfrage.');

    switch (action) {
      case 'createAppointment': {
        const appointment = await createAppointment(tenantId, parseAppointmentForm(body));
        return NextResponse.json({ ok: true, appointment });
      }
      case 'updateAppointment': {
        const id = requiredId(body, 'id');
        const appointment = await updateAppointment(tenantId, id, parseAppointmentForm(body));
        return NextResponse.json({ ok: true, appointment });
      }
      case 'deleteAppointment': {
        await deleteAppointment(tenantId, requiredId(body, 'id'));
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ ok: false, error: 'Unbekannte Aktion.' }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
