import { NextResponse } from 'next/server';
import { saveProcessAnswer } from '../../../../lib/db/process-documentation';
import { buildProcessDocumentation, getProcessFieldKeys } from '../../../../lib/process-documentation';
import { ForbiddenError, requireRole } from '../../../../lib/requireRole';
import { NoTenantError } from '../../../../lib/session';

// not exported: a Next route file may only export its HTTP handlers
const MAX_ANSWER_LENGTH = 4000;

/** The only fields that exist; an answer under any other key is refused. */
const FIELD_KEYS = new Set(
  getProcessFieldKeys(
    buildProcessDocumentation({
      companyName: 'x', ownerName: null, street: null, zip: null, city: null, phone: null, email: null,
      taxNumber: null, vatId: null, today: '2026-01-01',
    }),
  ),
);

/** Saves one answer of the Verfahrensdokumentation: `{ key, answer }`. Owner and office only. */
export async function POST(request: Request) {
  try {
    const { tenantId, userId } = await requireRole(['owner', 'office']);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Ungültige JSON-Anfrage.' }, { status: 400 });
    }
    const record = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    if (!record || typeof record.key !== 'string' || typeof record.answer !== 'string') {
      return NextResponse.json({ ok: false, error: 'Ungültige Anfrage.' }, { status: 400 });
    }
    if (!FIELD_KEYS.has(record.key)) {
      return NextResponse.json({ ok: false, error: 'Dieses Feld gibt es nicht.' }, { status: 400 });
    }
    const answer = record.answer.replace(/\r\n/g, '\n').trim();
    if (answer.length > MAX_ANSWER_LENGTH) {
      return NextResponse.json(
        { ok: false, error: `Die Antwort darf höchstens ${MAX_ANSWER_LENGTH} Zeichen lang sein.` },
        { status: 400 },
      );
    }

    await saveProcessAnswer(tenantId, userId, record.key, answer);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof NoTenantError) {
      return NextResponse.json({ ok: false, error: 'Keiner Werkstatt zugeordnet.' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    }
    console.error('Die Antwort konnte nicht gespeichert werden.', error);
    return NextResponse.json({ ok: false, error: 'Die Antwort konnte nicht gespeichert werden.' }, { status: 500 });
  }
}
