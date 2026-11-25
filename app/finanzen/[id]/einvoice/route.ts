import { NextResponse } from 'next/server';
import { getInvoice } from '../../../../lib/db/invoices';
import { buildEInvoiceXml, EInvoiceError, eInvoiceFileName } from '../../../../lib/e-invoice';
import { buildInvoicePdf, invoicePdfFileName } from '../../../../lib/invoice-pdf';
import { ForbiddenError, requireRole } from '../../../../lib/requireRole';
import { NoTenantError } from '../../../../lib/session';

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function errorResponse(error: unknown): NextResponse {
  if (error instanceof NoTenantError) {
    return NextResponse.json({ ok: false, error: 'Keiner Werkstatt zugeordnet.' }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ ok: false, error: 'Für Rechnungen fehlt die erforderliche Berechtigung.' }, { status: 403 });
  }
  if (error instanceof EInvoiceError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
  }
  console.error('Die E-Rechnung konnte nicht erstellt werden.', error);
  return NextResponse.json({ ok: false, error: 'Die E-Rechnung konnte nicht erstellt werden.' }, { status: 500 });
}

/**
 * Downloads an issued invoice (or Storno) as e-invoice: the XML (EN 16931, the data format of ZUGFeRD/Factur-X),
 * or with `?format=pdf` the hybrid ZUGFeRD PDF (PDF/A-3 with the XML embedded). Owner and office only.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!UUID_PATTERN.test(params.id)) {
      return NextResponse.json({ ok: false, error: 'Die Kennung ist ungültig.' }, { status: 400 });
    }
    const { tenantId } = await requireRole(['owner', 'office', 'mechanic']);
    const invoice = await getInvoice(tenantId, params.id);
    if (!invoice) return NextResponse.json({ ok: false, error: 'Die Rechnung wurde nicht gefunden.' }, { status: 404 });

    if (new URL(request.url).searchParams.get('format') === 'pdf') {
      const pdf = await buildInvoicePdf(invoice);
      return new Response(new Uint8Array(pdf), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${invoicePdfFileName(invoice.number ?? 'rechnung')}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const xml = buildEInvoiceXml(invoice);
    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${eInvoiceFileName(invoice.number ?? 'rechnung')}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
