import { NextResponse } from 'next/server';
import { dismissOnboarding, getOnboardingFacts } from '../../../lib/db/onboarding';
import { buildOnboardingStatus } from '../../../lib/onboarding';
import { ForbiddenError, requireRole } from '../../../lib/requireRole';
import { NoTenantError } from '../../../lib/session';

function errorResponse(error: unknown, message: string) {
  if (error instanceof NoTenantError) {
    return NextResponse.json({ ok: false, error: 'Keiner Werkstatt zugeordnet.' }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
  }
  console.error(message, error);
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

/** First-run checklist. Mechanics get `status: null` (the setup is not their job), so the dashboard shows nothing. */
export async function GET() {
  try {
    const { tenantId, role } = await requireRole(['owner', 'office', 'mechanic']);
    if (role === 'mechanic') return NextResponse.json({ ok: true, status: null });
    const status = buildOnboardingStatus(await getOnboardingFacts(tenantId));
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return errorResponse(error, 'Die Einrichtungs-Checkliste konnte nicht geladen werden.');
  }
}

/** Hides the checklist for the workshop. */
export async function POST() {
  try {
    const { tenantId } = await requireRole(['owner', 'office']);
    const dismissed = await dismissOnboarding(tenantId);
    if (!dismissed) {
      return NextResponse.json(
        { ok: false, error: 'Bitte speichere zuerst die Werkstattdaten unter „Einstellungen“.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, 'Die Checkliste konnte nicht ausgeblendet werden.');
  }
}
