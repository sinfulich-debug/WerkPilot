import Link from 'next/link';
import Sidebar from '../../../components/Sidebar';
import { getDateStringInTimeZone, INVOICE_TIME_ZONE } from '../../../lib/date';
import { getJournalInvoices } from '../../../lib/db/invoice-journal';
import { buildJournal, formatTaxRate, summarizeVat } from '../../../lib/invoice-journal';
import { formatEuro } from '../../../lib/money';
import {
  getPresetPeriod,
  parseReportPeriod,
  PERIOD_PRESET_LABEL,
  ReportPeriodError,
  type PeriodPreset,
  type ReportPeriod,
} from '../../../lib/report-period';
import { requireRole } from '../../../lib/requireRole';

const PRESETS: PeriodPreset[] = ['this-month', 'last-month', 'this-quarter', 'last-quarter', 'this-year', 'last-year'];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}

const FIELD = 'mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { from?: string | string[]; to?: string | string[] };
}) {
  // Only owner and office may see turnover; the database enforces the same rule.
  const { tenantId } = await requireRole(['owner', 'office', 'mechanic']);
  const today = getDateStringInTimeZone(new Date(), INVOICE_TIME_ZONE);

  let period: ReportPeriod = getPresetPeriod('this-month', today);
  let periodError: string | null = null;
  if (searchParams.from !== undefined || searchParams.to !== undefined) {
    try {
      period = parseReportPeriod(first(searchParams.from), first(searchParams.to));
    } catch (error) {
      if (!(error instanceof ReportPeriodError)) throw error;
      periodError = error.message;
    }
  }

  const rows = buildJournal(await getJournalInvoices(tenantId, period), period, today);
  const summary = summarizeVat(rows);
  const csvLink = `/finanzen/journal?from=${period.from}&to=${period.to}&format=csv`;

  return (
    <div className="min-h-screen bg-slate-100 md:h-screen md:overflow-hidden">
      <div className="flex flex-col md:h-full md:flex-row">
        <Sidebar />
        <main className="wp-stagger min-w-0 flex-1 bg-slate-50 px-4 py-6 md:h-full md:overflow-y-auto lg:px-10 lg:py-8">
          <header className="border-b border-slate-200 pb-6">
            <Link href="/finanzen" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              ← Zurück zu Finanzen
            </Link>
            <h1 className="mt-3 text-3xl font-medium tracking-tight text-slate-900">Berichte & Export</h1>
            <p className="mt-1 text-sm text-slate-500">
              Rechnungsjournal und Umsätze je Steuersatz für den Steuerberater. Stornorechnungen sind negativ enthalten und heben die
              stornierte Rechnung auf.
            </p>
          </header>

          <nav className="mt-5 flex flex-wrap gap-2" aria-label="Zeitraum">
            {PRESETS.map((preset) => {
              const range = getPresetPeriod(preset, today);
              const active = range.from === period.from && range.to === period.to;
              return (
                <Link
                  key={preset}
                  href={`/finanzen/berichte?from=${range.from}&to=${range.to}`}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-xl px-3 py-2 text-sm font-medium ${active ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`}
                >
                  {PERIOD_PRESET_LABEL[preset]}
                </Link>
              );
            })}
          </nav>

          <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm font-medium text-slate-700">
              Von
              <input type="date" name="from" defaultValue={period.from} required className={`${FIELD} block`} />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Bis (einschließlich)
              <input type="date" name="to" defaultValue={period.to} required className={`${FIELD} block`} />
            </label>
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              Anzeigen
            </button>
          </form>

          {periodError && (
            <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
              {periodError} Angezeigt wird {formatDate(period.from)} bis {formatDate(period.to)}.
            </p>
          )}

          <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200" aria-labelledby="vat-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="vat-heading" className="text-lg font-medium text-slate-900">
                Umsätze je Steuersatz · {formatDate(period.from)} – {formatDate(period.to)}
              </h2>
              <a
                href={csvLink}
                download
                className="rounded-xl border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-medium text-accent-700 hover:bg-slate-200/70"
              >
                CSV für den Steuerberater herunterladen
              </a>
            </div>
            {rows.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">In diesem Zeitraum wurden keine Rechnungen ausgestellt.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="px-3 py-2 font-medium">Steuersatz</th>
                      <th className="px-3 py-2 text-right font-medium">Netto</th>
                      <th className="px-3 py-2 text-right font-medium">Umsatzsteuer</th>
                      <th className="px-3 py-2 text-right font-medium">Brutto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.groups.map((group) => (
                      <tr key={group.taxRateBp} className="border-b border-slate-100">
                        <td className="px-3 py-2">{formatTaxRate(group.taxRateBp)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatEuro(group.netCents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatEuro(group.taxCents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatEuro(group.grossCents)}</td>
                      </tr>
                    ))}
                    <tr className="font-medium text-slate-900">
                      <td className="px-3 py-2">Gesamt</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatEuro(summary.netCents)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatEuro(summary.taxCents)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatEuro(summary.grossCents)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-3 text-sm text-slate-600">
                  Davon bezahlt: <strong>{formatEuro(summary.paidCents)}</strong> · noch offen: <strong>{formatEuro(summary.openCents)}</strong>
                </p>
              </div>
            )}
          </section>

          {rows.length > 0 && (
            <section className="mt-6 overflow-x-auto rounded-3xl bg-white shadow-sm ring-1 ring-slate-200" aria-label="Rechnungsjournal">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="px-4 py-3 font-medium">Nummer</th>
                    <th className="px-4 py-3 font-medium">Datum</th>
                    <th className="px-4 py-3 font-medium">Kunde</th>
                    <th className="px-4 py-3 font-medium">Art</th>
                    <th className="px-4 py-3 text-right font-medium">Netto</th>
                    <th className="px-4 py-3 text-right font-medium">USt</th>
                    <th className="px-4 py-3 text-right font-medium">Brutto</th>
                    <th className="px-4 py-3 text-right font-medium">Offen</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 align-top last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                        <Link href={`/finanzen/${row.id}/druck`} className="hover:underline">
                          {row.number}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{formatDate(row.issueDate)}</td>
                      <td className="px-4 py-3 text-slate-700">{row.customer}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.kind}
                        {row.reference && <span className="block text-xs text-slate-500">{row.reference}</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatEuro(row.netCents)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatEuro(row.taxCents)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{formatEuro(row.grossCents)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatEuro(row.openCents)}</td>
                      <td className="px-4 py-3 text-slate-600">{row.statusLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
