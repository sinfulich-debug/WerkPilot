import { NextResponse } from 'next/server';
import { getDateStringInTimeZone, INVOICE_TIME_ZONE } from '../../../lib/date';
import { getJournalInvoices } from '../../../lib/db/invoice-journal';
import { buildJournal, journalToCsv, summarizeVat } from '../../../lib/invoice-journal';
import { parseReportPeriod, ReportPeriodError } from '../../../lib/report-period';
import { ForbiddenError, requireRole } from '../../../lib/requireRole';
import { NoTenantError } from '../../../lib/session';

function errorResponse(error: unknown): NextResponse {
  if (error instanceof NoTenantError) {
    return NextResponse.json({ ok: false, error: 'Keiner Werkstatt zugeordnet.' }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ ok: false, error: 'Für Berichte fehlt die erforderliche Berechtigung.' }, { status: 403 });
  }
  if (error instanceof ReportPeriodError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  console.error('Das Rechnungsjournal konnte nicht erstellt werden.', error);
  return NextResponse.json({ ok: false, error: 'Das Rechnungsjournal konnte nicht erstellt werden.' }, { status: 500 });
}

/**
 * Invoice journal for a period: `?from=YYYY-MM-DD&to=YYYY-MM-DD`, with `&format=csv` as a download for
 * the tax advisor (Excel-compatible), otherwise JSON. Owner and office only.
 */
export async function GET(request: Request) {
  try {
    const { tenantId } = await requireRole(['owner', 'office', 'mechanic']);
    const params = new URL(request.url).searchParams;
    const period = parseReportPeriod(params.get('from'), params.get('to'));

    const today = getDateStringInTimeZone(new Date(), INVOICE_TIME_ZONE);
    const rows = buildJournal(await getJournalInvoices(tenantId, period), period, today);

    if (params.get('format') === 'csv') {
      return new Response(journalToCsv(rows), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="rechnungsjournal_${period.from}_${period.to}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return NextResponse.json({ ok: true, period, rows, summary: summarizeVat(rows) });
  } catch (error) {
    return errorResponse(error);
  }
}
