import { NextResponse } from 'next/server';
import { getWorkshopProfile } from '../../../lib/db/workshop';
import { requireRole } from '../../../lib/requireRole';
import { NoTenantError } from '../../../lib/session';

export async function GET() {
  try {
    const context = await requireRole(['owner', 'office', 'mechanic']);
    const profile = await getWorkshopProfile(context.tenantId);
    return NextResponse.json({ companyName: profile?.companyName ?? '' });
  } catch (error) {
    if (error instanceof NoTenantError) {
      return NextResponse.json({ error: 'Keiner Werkstatt zugeordnet.' }, { status: 401 });
    }
    console.error('Der Werkstattname konnte nicht geladen werden.', error);
    return NextResponse.json({ error: 'Der Werkstattname konnte nicht geladen werden.' }, { status: 500 });
  }
}
