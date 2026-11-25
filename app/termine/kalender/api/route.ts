import { NextResponse } from 'next/server';
import { AbsenceError, parseAbsenceInput } from '../../../../lib/absences';
import { CalendarSettingsError, parseCalendarSettings } from '../../../../lib/calendar-settings';
import {
  createAbsence,
  deleteAbsence,
  getAbsences,
  getCalendarSettings,
  InvalidAbsenceMechanicError,
  saveCalendarSettings,
  WorkshopProfileMissingError,
} from '../../../../lib/db/calendar';
import { ForbiddenError, requireRole } from '../../../../lib/requireRole';
import { NoTenantError } from '../../../../lib/session';

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

class ValidationError extends Error {}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof NoTenantError) {
    return NextResponse.json({ ok: false, error: 'Keiner Werkstatt zugeordnet.' }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
  }
  if (
    error instanceof ValidationError ||
    error instanceof AbsenceError ||
    error instanceof CalendarSettingsError ||
    error instanceof InvalidAbsenceMechanicError ||
    error instanceof WorkshopProfileMissingError
  ) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  console.error('Kalenderdaten konnten nicht verarbeitet werden.', error);
  return NextResponse.json({ ok: false, error: 'Kalenderdaten konnten nicht verarbeitet werden.' }, { status: 500 });
}

/** Settings and absences for the calendar. Every role may read them (mechanics see who is away). */
export async function GET() {
  try {
    const { tenantId, role } = await requireRole(['owner', 'office', 'mechanic']);
    const [settings, absences] = await Promise.all([getCalendarSettings(tenantId), getAbsences(tenantId)]);
    // canEdit only decides whether the page shows the settings button; POST checks the role again.
    return NextResponse.json({ ok: true, settings, absences, canEdit: role !== 'mechanic' });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Changing settings or absences is for owner and office only. */
export async function POST(request: Request) {
  const action = new URL(request.url).searchParams.get('action');
  if (!action || !['saveSettings', 'createAbsence', 'deleteAbsence'].includes(action)) {
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

    switch (action) {
      case 'saveSettings': {
        await saveCalendarSettings(tenantId, parseCalendarSettings(body));
        return NextResponse.json({ ok: true });
      }
      case 'createAbsence': {
        const absence = await createAbsence(tenantId, parseAbsenceInput(body));
        return NextResponse.json({ ok: true, absence });
      }
      default: {
        const id =
          typeof body === 'object' && body !== null && 'id' in body && typeof body.id === 'string' ? body.id : '';
        if (!UUID_PATTERN.test(id)) throw new ValidationError('Die Kennung ist ungültig.');
        await deleteAbsence(tenantId, id);
        return NextResponse.json({ ok: true });
      }
    }
  } catch (error) {
    return errorResponse(error);
  }
}
