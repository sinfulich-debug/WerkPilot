import { NextResponse } from 'next/server';
import { getWorkshopSettings } from '../../../lib/db/workshop';
import { ForbiddenError, requireRole } from '../../../lib/requireRole';
import { NoTenantError } from '../../../lib/session';

// The everyday settings every member of the workshop needs on its pages: hourly rate for estimates,
// reminder text for the TÜV list, bank details for the payment box of an invoice. Read only; the
// settings page (owner and office) is the only place that writes them.
export async function GET() {
  try {
    const { tenantId } = await requireRole(['owner', 'office', 'mechanic']);
    const settings = await getWorkshopSettings(tenantId);
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    if (error instanceof NoTenantError) {
      return NextResponse.json({ ok: false, error: 'Keiner Werkstatt zugeordnet.' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: 'Keine Berechtigung.' }, { status: 403 });
    }
    console.error('Die Werkstatt-Einstellungen konnten nicht geladen werden.', error);
    return NextResponse.json({ ok: false, error: 'Die Werkstatt-Einstellungen konnten nicht geladen werden.' }, { status: 500 });
  }
}
