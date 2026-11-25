import { NextResponse } from 'next/server';
import { getWorkshopProfile, saveWorkshopProfile, type WorkshopProfileInput } from '../../../lib/db/workshop';
import { getSessionContext, NoTenantError } from '../../../lib/session';
import { parseHourlyRateCents, parseWhatsappTemplate } from '../../../lib/workshop-settings';

const optionalStringFields = [
  'ownerName',
  'street',
  'zip',
  'city',
  'phone',
  'email',
  'website',
  'taxNumber',
  'vatId',
  'bankName',
  'iban',
  'bic',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseProfileInput(value: unknown):
  | { data: WorkshopProfileInput }
  | { error: string } {
  if (!isRecord(value)) return { error: 'Ungültige Profildaten.' };

  if (typeof value.companyName !== 'string' || !value.companyName.trim()) {
    return { error: 'Der Firmenname ist erforderlich.' };
  }

  for (const field of optionalStringFields) {
    if (value[field] !== undefined && value[field] !== null && typeof value[field] !== 'string') {
      return { error: `Das Feld „${field}“ muss Text enthalten.` };
    }
  }
  if (
    value.isSmallBusiness !== undefined &&
    value.isSmallBusiness !== null &&
    typeof value.isSmallBusiness !== 'boolean'
  ) {
    return { error: 'Die Einstellung zur Kleinunternehmerregelung ist ungültig.' };
  }

  // Not sent (or null) = keep what is stored; sent = checked by the shared rules.
  let hourlyRateCents: number | undefined;
  if (value.hourlyRateCents !== undefined && value.hourlyRateCents !== null) {
    const rate = parseHourlyRateCents(value.hourlyRateCents);
    if (!rate.ok) return { error: rate.message };
    hourlyRateCents = rate.value;
  }
  let whatsappTemplate: string | null | undefined;
  if (value.whatsappTemplate !== undefined && value.whatsappTemplate !== null) {
    const template = parseWhatsappTemplate(value.whatsappTemplate);
    if (!template.ok) return { error: template.message };
    whatsappTemplate = template.value;
  }

  const optionalString = (field: (typeof optionalStringFields)[number]) =>
    typeof value[field] === 'string' ? value[field] : undefined;

  return {
    data: {
      companyName: value.companyName.trim(),
      ownerName: optionalString('ownerName'),
      street: optionalString('street'),
      zip: optionalString('zip'),
      city: optionalString('city'),
      phone: optionalString('phone'),
      email: optionalString('email'),
      website: optionalString('website'),
      taxNumber: optionalString('taxNumber'),
      vatId: optionalString('vatId'),
      bankName: optionalString('bankName'),
      iban: optionalString('iban'),
      bic: optionalString('bic'),
      isSmallBusiness: typeof value.isSmallBusiness === 'boolean' ? value.isSmallBusiness : undefined,
      hourlyRateCents,
      whatsappTemplate,
    },
  };
}

export async function GET() {
  try {
    const context = await getSessionContext();
    if (context.role === 'mechanic') {
      return NextResponse.json({ ok: false, error: 'Keine Berechtigung für Werkstatt-Stammdaten.' }, { status: 403 });
    }

    const profile = await getWorkshopProfile(context.tenantId);
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    if (error instanceof NoTenantError) {
      return NextResponse.json({ ok: false, error: 'Keiner Werkstatt zugeordnet.' }, { status: 401 });
    }
    console.error('Werkstattprofil konnte nicht geladen werden.', error);
    return NextResponse.json({ ok: false, error: 'Einstellungen konnten nicht geladen werden.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Ungültige JSON-Anfrage.' }, { status: 400 });
  }

  const parsed = parseProfileInput(body);
  if ('error' in parsed) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  try {
    const context = await getSessionContext();
    if (context.role === 'mechanic') {
      return NextResponse.json({ ok: false, error: 'Keine Berechtigung für Werkstatt-Stammdaten.' }, { status: 403 });
    }

    await saveWorkshopProfile(context.tenantId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof NoTenantError) {
      return NextResponse.json({ ok: false, error: 'Keiner Werkstatt zugeordnet.' }, { status: 401 });
    }
    console.error('Werkstattprofil konnte nicht gespeichert werden.', error);
    return NextResponse.json({ ok: false, error: 'Einstellungen konnten nicht gespeichert werden.' }, { status: 500 });
  }
}
