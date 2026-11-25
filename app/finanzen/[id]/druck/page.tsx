import Link from 'next/link';
import { notFound } from 'next/navigation';
import PrintInvoiceButton from '../../../../components/PrintInvoiceButton';
import { getInvoice } from '../../../../lib/db/invoices';
import { INVOICE_TIME_ZONE } from '../../../../lib/date';
import { getInvoiceTotals } from '../../../../lib/finance';
import { unitLabel } from '../../../../lib/units';
import { checkInvoiceCompliance } from '../../../../lib/invoice-compliance';
import { requireRole } from '../../../../lib/requireRole';

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const quantityFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 });
const dateFormat = new Intl.DateTimeFormat('de-DE', {
  timeZone: INVOICE_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function formatDate(value: string | null): string {
  if (!value) return '–';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00.000Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError('Ungültiges Rechnungsdatum.');
  return dateFormat.format(date);
}

function addressLines(street: string | null, zip: string | null, city: string | null): string[] {
  return [street, [zip, city].filter(Boolean).join(' ') || null].filter(
    (line): line is string => Boolean(line),
  );
}

export default async function InvoicePrintPage({
  params,
}: {
  params: { id: string };
}) {
  if (!uuidPattern.test(params.id)) notFound();

  const { tenantId } = await requireRole(['owner', 'office', 'mechanic']);
  const invoice = await getInvoice(tenantId, params.id);
  if (!invoice) notFound();

  const totals = getInvoiceTotals(invoice.lines, invoice.taxMode);
  const complianceGaps = checkInvoiceCompliance(invoice);
  const sellerAddress = addressLines(
    invoice.sellerSnapshot.street,
    invoice.sellerSnapshot.zip,
    invoice.sellerSnapshot.city,
  );
  const buyerAddress = addressLines(
    invoice.buyerSnapshot.street,
    invoice.buyerSnapshot.zip,
    invoice.buyerSnapshot.city,
  );
  const taxLabel =
    invoice.taxMode === 'standard19' ? '19 %' : invoice.taxMode === 'reduced7' ? '7 %' : null;

  return (
    <main className="min-h-screen bg-slate-100 p-4 print:min-h-0 print:bg-white print:p-0">
      <article className="mx-auto max-w-[210mm] rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200 print:max-w-none print:rounded-none print:p-0 print:shadow-none print:ring-0">
        <nav className="mb-8 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link href="/finanzen" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
            Zurück zu Rechnungen
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            {invoice.number && (
              <>
                <a href={`/finanzen/${invoice.id}/einvoice?format=pdf`} download className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                  ZUGFeRD-PDF herunterladen
                </a>
                <a href={`/finanzen/${invoice.id}/einvoice`} download className="text-sm font-semibold text-slate-600 hover:text-slate-900">
                  E-Rechnung (XML)
                </a>
              </>
            )}
            <PrintInvoiceButton />
          </div>
        </nav>

        <p className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 print:hidden">
          Prüfansicht auf Basis der gespeicherten Verkäufer- und Käuferdaten. Vor dem produktiven Einsatz steuerlich freigeben lassen; diese Ansicht erzeugt keine ZUGFeRD-E-Rechnung.
        </p>

        {complianceGaps.length > 0 && (
          <div role="alert" className="mb-6 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 print:hidden">
            <p className="font-semibold">Pflichtangaben nach § 14 Abs. 4 UStG fehlen:</p>
            <ul className="mt-1 list-disc pl-5">
              {complianceGaps.map((gap) => (
                <li key={gap.code}>{gap.message}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs">Ergänze die Daten unter „Einstellungen“ (Werkstatt) bzw. beim Kunden, bevor du die Rechnung versendest.</p>
          </div>
        )}

        {invoice.status === 'draft' && (
          <p className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 print:rounded-none print:border-2 print:text-center">
            ENTWURF – NICHT RECHTSVERBINDLICH
          </p>
        )}

        {invoice.cancelsInvoiceId && (
          <p className="mb-6 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900 print:rounded-none print:border-2 print:text-center">
            STORNORECHNUNG zu Rechnung {invoice.cancelsNumber ?? ''}
          </p>
        )}
        {invoice.cancelsInvoiceId && (
          <p className="mb-6 text-sm text-slate-700">
            Diese Stornorechnung hebt die Rechnung {invoice.cancelsNumber ?? ''} vollständig auf. Der Betrag wird mit dieser Rechnung verrechnet
            bzw. erstattet.
          </p>
        )}
        {invoice.status === 'cancelled' && (
          <p className="mb-6 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900 print:rounded-none print:border-2 print:text-center">
            STORNIERT{invoice.cancelledByNumber ? ` durch Stornorechnung ${invoice.cancelledByNumber}` : ''}
          </p>
        )}

        <header className="grid gap-8 border-b-2 border-slate-900 pb-7 sm:grid-cols-2">
          <section aria-label="Rechnungsempfänger">
            <p className="mb-1 text-xs text-slate-500">Rechnungsempfänger</p>
            <h1 className="text-xl font-bold text-slate-900">{invoice.buyerSnapshot.name}</h1>
            {buyerAddress.map((line) => <p key={line} className="text-sm text-slate-700">{line}</p>)}
            {invoice.buyerSnapshot.email && <p className="mt-2 text-sm text-slate-700">{invoice.buyerSnapshot.email}</p>}
            {invoice.buyerSnapshot.phone && <p className="text-sm text-slate-700">{invoice.buyerSnapshot.phone}</p>}
          </section>

          <section className="sm:text-right" aria-label="Rechnungssteller">
            <h2 className="text-2xl font-bold text-slate-900">{invoice.sellerSnapshot.companyName}</h2>
            {invoice.sellerSnapshot.ownerName && <p className="text-sm text-slate-700">{invoice.sellerSnapshot.ownerName}</p>}
            {sellerAddress.map((line) => <p key={line} className="text-sm text-slate-700">{line}</p>)}
            {invoice.sellerSnapshot.phone && <p className="mt-2 text-sm text-slate-700">{invoice.sellerSnapshot.phone}</p>}
            {invoice.sellerSnapshot.email && <p className="text-sm text-slate-700">{invoice.sellerSnapshot.email}</p>}
            {invoice.sellerSnapshot.website && <p className="text-sm text-slate-700">{invoice.sellerSnapshot.website}</p>}
          </section>
        </header>

        <section className="grid gap-4 border-b border-slate-200 py-6 sm:grid-cols-3">
          <div>
            <p className="text-xs text-slate-500">Rechnungsnummer</p>
            <p className="font-semibold text-slate-900">{invoice.number ?? 'Entwurf'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Rechnungsdatum</p>
            <p className="font-semibold text-slate-900">{formatDate(invoice.issuedAt)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Leistungsdatum</p>
            <p className="font-semibold text-slate-900">{formatDate(invoice.serviceDate)}</p>
          </div>
          {!invoice.cancelsInvoiceId && (
            <div>
              <p className="text-xs text-slate-500">Fällig am</p>
              <p className="font-semibold text-slate-900">{formatDate(invoice.dueAt)}</p>
            </div>
          )}
          {invoice.buyerSnapshot.vehiclePlate && (
            <div>
              <p className="text-xs text-slate-500">Kennzeichen</p>
              <p className="font-semibold text-slate-900">{invoice.buyerSnapshot.vehiclePlate}</p>
            </div>
          )}
        </section>

        <table className="mt-6 w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b-2 border-slate-800">
              <th className="py-3 pr-3 font-semibold text-slate-900">Leistung / Artikel</th>
              <th className="px-2 py-3 text-right font-semibold text-slate-900">Menge</th>
              <th className="px-2 py-3 text-right font-semibold text-slate-900">Einzelpreis netto</th>
              <th className="py-3 pl-2 text-right font-semibold text-slate-900">Betrag netto</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={line.id} className="border-b border-slate-200 align-top">
                <td className="py-3 pr-3 text-slate-800">{line.description}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-700">{quantityFormat.format(line.quantity)} {unitLabel(line.unit)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-700">{euro.format(line.unitPrice)}</td>
                <td className="py-3 pl-2 text-right tabular-nums text-slate-900">
                  {euro.format(getInvoiceTotals([line], invoice.taxMode).net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="ml-auto mt-6 w-full max-w-sm">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Nettobetrag</dt>
              <dd className="font-medium tabular-nums text-slate-900">{euro.format(totals.net)}</dd>
            </div>
            {taxLabel ? (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Umsatzsteuer {taxLabel}</dt>
                <dd className="font-medium tabular-nums text-slate-900">{euro.format(totals.tax)}</dd>
              </div>
            ) : (
              <p className="text-xs text-slate-600">Kein Umsatzsteuerausweis gemäß § 19 UStG.</p>
            )}
            <div className="flex justify-between gap-4 border-t-2 border-slate-900 pt-3 text-base">
              <dt className="font-bold text-slate-900">Rechnungsbetrag</dt>
              <dd className="font-bold tabular-nums text-slate-900">{euro.format(totals.gross)}</dd>
            </div>
          </dl>
        </section>

        {(invoice.sellerSnapshot.taxNumber ||
          invoice.sellerSnapshot.vatId ||
          invoice.sellerSnapshot.iban ||
          invoice.sellerSnapshot.bic) && (
          <footer className="mt-12 grid gap-5 border-t border-slate-300 pt-5 text-xs text-slate-600 sm:grid-cols-2">
            <div>
              {invoice.sellerSnapshot.taxNumber && <p>Steuernummer: {invoice.sellerSnapshot.taxNumber}</p>}
              {invoice.sellerSnapshot.vatId && <p>USt-IdNr.: {invoice.sellerSnapshot.vatId}</p>}
            </div>
            <div className="sm:text-right">
              {invoice.sellerSnapshot.bankName && <p>{invoice.sellerSnapshot.bankName}</p>}
              {invoice.sellerSnapshot.iban && <p>IBAN: {invoice.sellerSnapshot.iban}</p>}
              {invoice.sellerSnapshot.bic && <p>BIC: {invoice.sellerSnapshot.bic}</p>}
            </div>
          </footer>
        )}
      </article>
    </main>
  );
}
