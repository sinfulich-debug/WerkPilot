import { NextResponse } from 'next/server';
import { buildImportPreview, MAX_IMPORT_BYTES, parseCsv, parseMapping } from '../../../../lib/customer-import';
import { importCustomers } from '../../../../lib/db/customer-import';
import { ForbiddenError, requireRole } from '../../../../lib/requireRole';
import { NoTenantError } from '../../../../lib/session';

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

/**
 * Imports customers and vehicles from CSV text. The server parses the file again with the same pure functions
 * as the browser preview, so only checked rows are saved.
 */
export async function POST(request: Request) {
  try {
    const { tenantId } = await requireRole(['owner', 'office']);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Ungültige JSON-Anfrage.');
    }
    if (typeof body !== 'object' || body === null) return badRequest('Ungültige Anfrage.');
    const { csv, mapping: rawMapping } = body as { csv?: unknown; mapping?: unknown };

    if (typeof csv !== 'string' || !csv.trim()) return badRequest('Die Datei ist leer.');
    if (new TextEncoder().encode(csv).length > MAX_IMPORT_BYTES) {
      return badRequest('Die Datei ist zu groß (höchstens 2 MB).');
    }

    const columnCount = parseCsv(csv)[0]?.length ?? 0;
    const mapping = parseMapping(rawMapping, columnCount);
    if (!mapping) return badRequest('Die Spaltenzuordnung ist ungültig.');

    const preview = buildImportPreview(csv, mapping);
    if (preview.error) return badRequest(preview.error);

    const result = await importCustomers(tenantId, preview.rows);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof NoTenantError) {
      return NextResponse.json({ ok: false, error: 'Keiner Werkstatt zugeordnet.' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    }
    console.error('Der Import ist fehlgeschlagen.', error);
    return NextResponse.json({ ok: false, error: 'Der Import ist fehlgeschlagen. Es wurde nichts gespeichert.' }, { status: 500 });
  }
}
