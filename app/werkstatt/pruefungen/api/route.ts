import { NextResponse } from 'next/server';
import {
  createInspection,
  deleteInspection,
  deleteInspectionPhoto,
  getInspectionPhoto,
  importInspections,
  InspectionNotFoundError,
  listInspections,
  setInspectionPhoto,
  updateInspectionHeader,
  updateInspectionItem,
} from '../../../../lib/db/inspections';
import { getDatabaseErrorCode, PG_CHECK_VIOLATION } from '../../../../lib/db-error';
import {
  IMPORT_BATCH_SIZE,
  isUuid,
  parseInspectionHeader,
  parseItemChange,
  parseLegacyInspections,
  parsePhotoDataUrl,
} from '../../../../lib/inspections';
import { ForbiddenError, requireRole } from '../../../../lib/requireRole';
import { NoTenantError } from '../../../../lib/session';

// Vehicle inspections (DVI). All members of the workshop may read and fill them in;
// deleting a whole inspection is for owner and office (the database enforces the same).

const ACTIONS = ['create', 'updateHeader', 'updateItem', 'setPhoto', 'deletePhoto', 'delete', 'import'] as const;
type Action = (typeof ACTIONS)[number];

class ValidationError extends Error {}

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function errorResponse(error: unknown) {
  if (error instanceof NoTenantError) return fail(401, 'Keiner Werkstatt zugeordnet.');
  if (error instanceof ForbiddenError) return fail(403, 'Nur Inhaber und Büro dürfen Fahrzeugprüfungen löschen.');
  if (error instanceof ValidationError) return fail(400, error.message);
  if (error instanceof InspectionNotFoundError) return fail(404, error.message);
  if (getDatabaseErrorCode(error) === PG_CHECK_VIOLATION) return fail(400, 'Die Angaben sind ungültig.');
  console.error('Fahrzeugprüfungen konnten nicht verarbeitet werden.', error);
  return fail(500, 'Fahrzeugprüfungen konnten nicht verarbeitet werden.');
}

function requiredId(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (!isUuid(value)) throw new ValidationError('Die Kennung ist ungültig.');
  return value;
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!result.ok) throw new ValidationError(result.message);
  return result.value;
}

/** GET: list of inspections, or with ?photo=<itemId> the photo of one item. */
export async function GET(request: Request) {
  try {
    const { tenantId } = await requireRole(['owner', 'office', 'mechanic']);
    const photoOf = new URL(request.url).searchParams.get('photo');
    if (photoOf !== null) {
      if (!isUuid(photoOf)) throw new ValidationError('Die Kennung ist ungültig.');
      const photo = await getInspectionPhoto(tenantId, photoOf);
      if (!photo) return fail(404, 'Zu diesem Prüfpunkt gibt es kein Foto.');
      return NextResponse.json({ ok: true, photo });
    }
    return NextResponse.json({ ok: true, inspections: await listInspections(tenantId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const action = new URL(request.url).searchParams.get('action') as Action | null;
  if (!action || !ACTIONS.includes(action)) return fail(400, 'Unbekannte Aktion.');

  try {
    const { tenantId } = await requireRole(action === 'delete' ? ['owner', 'office'] : ['owner', 'office', 'mechanic']);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Ungültige JSON-Anfrage.');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ValidationError('Ungültige Anfrage.');
    const value = body as Record<string, unknown>;

    switch (action) {
      case 'create': {
        const inspection = await createInspection(tenantId, unwrap(parseInspectionHeader(value)));
        return NextResponse.json({ ok: true, inspection }, { status: 201 });
      }
      case 'updateHeader':
        await updateInspectionHeader(tenantId, requiredId(value, 'id'), unwrap(parseInspectionHeader(value)));
        return NextResponse.json({ ok: true });
      case 'updateItem':
        await updateInspectionItem(tenantId, requiredId(value, 'itemId'), unwrap(parseItemChange(value)));
        return NextResponse.json({ ok: true });
      case 'setPhoto':
        await setInspectionPhoto(tenantId, requiredId(value, 'itemId'), unwrap(parsePhotoDataUrl(value.photo)));
        return NextResponse.json({ ok: true });
      case 'deletePhoto':
        await deleteInspectionPhoto(tenantId, requiredId(value, 'itemId'));
        return NextResponse.json({ ok: true });
      case 'delete':
        await deleteInspection(tenantId, requiredId(value, 'id'));
        return NextResponse.json({ ok: true });
      case 'import': {
        if (!Array.isArray(value.inspections)) throw new ValidationError('Es wurden keine Prüfungen übergeben.');
        if (value.inspections.length > IMPORT_BATCH_SIZE) {
          throw new ValidationError(`Bitte höchstens ${IMPORT_BATCH_SIZE} Prüfungen auf einmal übernehmen.`);
        }
        const { inspections, skipped } = parseLegacyInspections(value.inspections);
        const imported = await importInspections(tenantId, inspections);
        return NextResponse.json({ ok: true, imported, skipped });
      }
      default:
        return fail(400, 'Unbekannte Aktion.');
    }
  } catch (error) {
    return errorResponse(error);
  }
}
