import { NextResponse } from 'next/server';
import {
  createTireStorage,
  listTireStorages,
  markTireReminderSent,
  releaseTireStorage,
  SlotTakenError,
  TireStorageNotFoundError,
  updateTireStorage,
} from '../../../lib/db/tire-storage';
import { getDatabaseErrorCode, PG_CHECK_VIOLATION } from '../../../lib/db-error';
import { isUuid } from '../../../lib/inspections';
import { ForbiddenError, requireRole } from '../../../lib/requireRole';
import { NoTenantError } from '../../../lib/session';
import {
  isTireSeason,
  TireStorageValidationError,
  validateTireStorageInput,
  type TireStorageInput,
} from '../../../lib/tire-storage';

// Tire storage (Reifenlager). All members may look up where a set is stored;
// storing, changing and releasing sets is for owner and office (the database enforces the same).

const ACTIONS = ['create', 'update', 'release', 'markReminderSent'] as const;
type Action = (typeof ACTIONS)[number];

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function errorResponse(error: unknown) {
  if (error instanceof NoTenantError) return fail(401, 'Keiner Werkstatt zugeordnet.');
  if (error instanceof ForbiddenError) return fail(403, error.message);
  if (error instanceof TireStorageValidationError) return fail(400, error.message);
  if (error instanceof TireStorageNotFoundError) return fail(404, error.message);
  if (error instanceof SlotTakenError) return fail(409, error.message);
  if (getDatabaseErrorCode(error) === PG_CHECK_VIOLATION) return fail(400, 'Die Angaben sind ungültig.');
  console.error('Das Reifenlager konnte nicht verarbeitet werden.', error);
  return fail(500, 'Das Reifenlager konnte nicht verarbeitet werden.');
}

function requiredId(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (!isUuid(value)) throw new TireStorageValidationError('Die Kennung ist ungültig.');
  return value;
}

function text(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new TireStorageValidationError('Die Angaben sind ungültig.');
  return value;
}

function parseInput(body: Record<string, unknown>): TireStorageInput {
  const vehicleId = body.vehicleId;
  if (vehicleId !== undefined && vehicleId !== null && !isUuid(vehicleId)) {
    throw new TireStorageValidationError('Die Kennung ist ungültig.');
  }
  const depth = body.treadDepthTenthMm;
  if (depth !== undefined && depth !== null && typeof depth !== 'number') {
    throw new TireStorageValidationError('Die Profiltiefe ist ungültig (0 bis 15 mm).');
  }
  if (!isTireSeason(body.season)) throw new TireStorageValidationError('Bitte wähle die Saison der Reifen.');

  return validateTireStorageInput({
    customerId: requiredId(body, 'customerId'),
    vehicleId: typeof vehicleId === 'string' ? vehicleId : undefined,
    slot: text(body, 'slot'),
    season: body.season,
    description: text(body, 'description'),
    treadDepthTenthMm: typeof depth === 'number' ? depth : undefined,
    storedAt: text(body, 'storedAt'),
    notes: text(body, 'notes') || undefined,
  });
}

export async function GET() {
  try {
    const { tenantId } = await requireRole(['owner', 'office', 'mechanic']);
    return NextResponse.json({ ok: true, tireStorages: await listTireStorages(tenantId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const action = new URL(request.url).searchParams.get('action') as Action | null;
  if (!action || !ACTIONS.includes(action)) return fail(400, 'Unbekannte Aktion.');

  try {
    const { tenantId } = await requireRole(['owner', 'office']);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new TireStorageValidationError('Ungültige JSON-Anfrage.');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new TireStorageValidationError('Ungültige Anfrage.');
    }
    const value = body as Record<string, unknown>;

    switch (action) {
      case 'create':
        return NextResponse.json({ ok: true, tireStorage: await createTireStorage(tenantId, parseInput(value)) }, { status: 201 });
      case 'update':
        return NextResponse.json({
          ok: true,
          tireStorage: await updateTireStorage(tenantId, requiredId(value, 'id'), parseInput(value)),
        });
      case 'release':
        await releaseTireStorage(tenantId, requiredId(value, 'id'));
        return NextResponse.json({ ok: true });
      case 'markReminderSent':
        await markTireReminderSent(tenantId, requiredId(value, 'id'));
        return NextResponse.json({ ok: true });
      default:
        return fail(400, 'Unbekannte Aktion.');
    }
  } catch (error) {
    return errorResponse(error);
  }
}
