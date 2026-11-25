'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CheckCircle2, Copy, Plus, Printer, ReceiptText, WalletCards, X } from 'lucide-react';
import ConfirmDialog from '../../components/ConfirmDialog';
import PaymentDialog from '../../components/finance/PaymentDialog';
import ReminderDialog from '../../components/finance/ReminderDialog';
import Sidebar from '../../components/Sidebar';
import { useCustomers } from '../../lib/hooks/useCustomers';
import { useInvoices } from '../../lib/hooks/useInvoices';
import { useWorkshopSettings } from '../../lib/hooks/useWorkshopSettings';
import { centsToEuros, defaultTaxMode, DEFAULT_HOURLY_RATE_CENTS } from '../../lib/workshop-settings';
import { addDaysToDateString, getDateStringInTimeZone, INVOICE_TIME_ZONE } from '../../lib/date';
import {
  createEpcPaymentData,
  getInvoiceTotals,
  taxModes,
  type Invoice,
  type InvoiceInput,
  type InvoiceLine,
  type TaxMode,
} from '../../lib/finance';
import { formatEuro } from '../../lib/money';
import { DEFAULT_UNIT, UNITS, type UnitCode } from '../../lib/units';
import { eurosToCents, getPaymentSummary, paymentLabel, type PaymentSummary } from '../../lib/payment-status';

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const DEFAULT_LABOR_RATE_EUROS = centsToEuros(DEFAULT_HOURLY_RATE_CENTS);

export default function FinancePage() {
  const {
    invoices,
    isLoaded: invoicesLoaded,
    error: invoicesError,
    createInvoice,
    issueInvoice,
    cancelInvoice,
    addPayment,
  } = useInvoices();
  const [invoiceToCancel, setInvoiceToCancel] = useState<Invoice | null>(null);
  const [invoiceToPay, setInvoiceToPay] = useState<Invoice | null>(null);
  const [invoiceToRemind, setInvoiceToRemind] = useState<Invoice | null>(null);
  const [today] = useState(() => getDateStringInTimeZone(new Date(), INVOICE_TIME_ZONE));
  const { customers, vehicles, isLoaded: customersLoaded } = useCustomers();
  // Bank details and the tax rule come from the workshop settings in the database.
  const { settings: workshopSettings, isLoaded: settingsLoaded, error: settingsError } = useWorkshopSettings();
  const bank = {
    companyName: workshopSettings.companyName,
    bankName: workshopSettings.bankName,
    iban: workshopSettings.iban,
    bic: workshopSettings.bic,
  };
  const bankNotice = settingsError ? `Die Bankverbindung konnte nicht geladen werden: ${settingsError}` : '';
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [taxMode, setTaxMode] = useState<TaxMode>('standard19');
  const [lines, setLines] = useState<InvoiceLine[]>([{ id: 'position-1', description: 'Arbeitsleistung', quantity: 1, unit: 'HUR', unitPrice: DEFAULT_LABOR_RATE_EUROS }]);
  const [message, setMessageText] = useState('');
  const [dismissedNotice, setDismissedNotice] = useState('');
  // A new message always shows again, even when it has the same text as one the user closed before.
  const setMessage = useCallback((text: string) => {
    setMessageText(text);
    setDismissedNotice('');
  }, []);
  const [paymentInvoiceId, setPaymentInvoiceId] = useState('');

  // The form starts with the tax rule of the workshop (small-business rule or normal 19 %).
  // The first labour line starts with the workshop's hourly rate (only while nobody has touched it).
  const isSmallBusiness = workshopSettings.isSmallBusiness;
  const hourlyRateEuros = centsToEuros(workshopSettings.hourlyRateCents);
  useEffect(() => {
    if (!settingsLoaded) return;
    setTaxMode(defaultTaxMode(isSmallBusiness));
    setLines((current) => (
      current.length === 1 && current[0].id === 'position-1' && current[0].unitPrice === DEFAULT_LABOR_RATE_EUROS
        ? [{ ...current[0], unitPrice: hourlyRateEuros }]
        : current
    ));
  }, [settingsLoaded, isSmallBusiness, hourlyRateEuros]);

  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId);
  const customerVehicle = vehicles.find((vehicle) => vehicle.customerId === selectedCustomerId);
  const totalsState = useMemo(() => {
    try {
      return { totals: getInvoiceTotals(lines, taxMode), error: null };
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return {
        totals: null,
        error: 'Bitte gib Mengen mit höchstens drei und Preise mit höchstens zwei Nachkommastellen ein.',
      };
    }
  }, [lines, taxMode]);
  const totals = totalsState.totals;
  const summaryOf = (invoice: Invoice): PaymentSummary =>
    getPaymentSummary({
      status: invoice.status,
      cancelsInvoiceId: invoice.cancelsInvoiceId,
      grossCents: eurosToCents(getInvoiceTotals(invoice.lines, invoice.taxMode).gross),
      paidCents: eurosToCents(invoice.paidAmount),
      dueDate: invoice.dueAt,
      today,
    });
  // Only invoices with something still to pay. A Storno document is "issued" too, but it is a credit.
  const openInvoices = invoices.filter((invoice) => summaryOf(invoice).openCents > 0);
  const paymentInvoice = openInvoices.find((invoice) => invoice.id === paymentInvoiceId) ?? openInvoices[0];
  // The transfer amount is what is still open, not the full invoice total.
  const paymentAmount = paymentInvoice ? summaryOf(paymentInvoice).openCents / 100 : (totals?.gross ?? null);
  const paymentReference = paymentInvoice?.number ?? 'Werkstattrechnung';
  const epcData = bank.iban && paymentAmount !== null
    ? createEpcPaymentData({ recipient: bank.companyName || 'Werkstatt', iban: bank.iban, bic: bank.bic, amount: paymentAmount, reference: paymentReference })
    : '';

  const addLine = () => setLines((current) => [...current, { id: crypto.randomUUID(), description: '', quantity: 1, unit: 'C62', unitPrice: 0 }]);
  const updateLine = (id: string, changes: Partial<InvoiceLine>) => setLines((current) => current.map((line) => line.id === id ? { ...line, ...changes } : line));
  const removeLine = (id: string) => setLines((current) => current.length > 1 ? current.filter((line) => line.id !== id) : current);

  const saveInvoice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCustomer) return;
    if (!totals) {
      setMessage('Bitte korrigiere zuerst die Mengen und Einzelpreise.');
      return;
    }
    const serviceDate = getDateStringInTimeZone(new Date(), INVOICE_TIME_ZONE);
    const input: InvoiceInput = {
      customerId: selectedCustomer.id,
      vehicleId: customerVehicle?.id,
      serviceDate,
      dueAt: addDaysToDateString(serviceDate, 14),
      lines: lines.map(({ description, quantity, unit, unitPrice }) => ({
        description: description.trim(),
        quantity,
        unit: unit ?? DEFAULT_UNIT,
        unitPrice,
      })),
      taxMode,
    };
    const invoice = await createInvoice(input);
    if (!invoice) return;
    setPaymentInvoiceId(invoice.id);
    setMessage('Rechnungsentwurf wurde gespeichert. Die Rechnungsnummer wird beim Ausstellen vergeben.');
  };

  const issueDraft = async (invoice: Invoice) => {
    const number = await issueInvoice(invoice.id);
    if (!number) return;
    setPaymentInvoiceId(invoice.id);
    setMessage(`Rechnung ${number} wurde ausgestellt.`);
  };

  const confirmCancel = async () => {
    if (!invoiceToCancel) return;
    const original = invoiceToCancel;
    setInvoiceToCancel(null);
    const number = await cancelInvoice(original.id);
    if (number) setMessage(`Rechnung ${original.number ?? ''} wurde storniert. Die Stornorechnung hat die Nummer ${number}.`);
  };

  /** Records a payment and tells the user what happened; null means success, otherwise the error text. */
  const recordPayment = async (invoice: Invoice, amountCents: number, paidAt: string): Promise<string | null> => {
    const failure = await addPayment(invoice.id, amountCents / 100, paidAt);
    if (failure) return failure;
    const remaining = summaryOf(invoice).openCents - amountCents;
    setMessage(
      remaining > 0
        ? `Zahlung von ${formatEuro(amountCents)} für Rechnung ${invoice.number ?? ''} wurde erfasst. Noch offen: ${formatEuro(remaining)}.`
        : `Rechnung ${invoice.number ?? ''} ist vollständig bezahlt.`,
    );
    return null;
  };

  /** "Als bezahlt markieren": pays whatever is still open, so it also works after a part payment. */
  const markPaid = async (invoice: Invoice) => {
    const failure = await recordPayment(invoice, summaryOf(invoice).openCents, new Date().toISOString());
    if (failure) setMessage(`Die Zahlung konnte nicht erfasst werden. ${failure}`);
  };

  // One visible notice at the bottom of the screen: errors first, then the latest message.
  const noticeText = invoicesError || totalsState.error || bankNotice || message;
  const isErrorNotice = Boolean(invoicesError || totalsState.error || bankNotice);

  const copyPaymentData = async () => {
    if (paymentAmount === null) {
      setMessage('Bitte korrigiere zuerst die Mengen und Einzelpreise.');
      return;
    }
    if (!epcData) {
      setMessage('Hinterlege zuerst IBAN und BIC unter Einstellungen.');
      return;
    }
    try {
      await navigator.clipboard.writeText(epcData);
      setMessage('SEPA-Zahlungsdaten wurden kopiert.');
    } catch (error) {
      console.error('SEPA-Zahlungsdaten konnten nicht kopiert werden.', error);
      setMessage('Kopieren nicht möglich. Markiere die Zahlungsdaten und kopiere sie manuell.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 md:h-screen md:overflow-hidden">
      <div className="flex flex-col md:h-full md:flex-row">
        <Sidebar />
        <main className="wp-stagger min-w-0 flex-1 bg-slate-50 px-4 py-6 md:h-full md:overflow-y-auto lg:px-10 lg:py-8">
          <header className="border-b border-slate-200 pb-6">
            <p className="text-sm font-medium text-slate-500">Finanzen & Zahlungen</p>
            <h1 className="mt-2 text-3xl font-medium tracking-tight text-slate-900">Rechnungen & Zahlungseingänge</h1>
            <p className="mt-1 text-sm text-slate-500">Rechnungsentwürfe kalkulieren, Zahlungsstatus verwalten und SEPA-Daten bereitstellen</p>
            <div className="mt-3 flex flex-wrap gap-4">
              <Link href="/finanzen/berichte" className="text-sm font-medium text-accent-700 hover:underline">
                Berichte & Export für den Steuerberater
              </Link>
              <Link href="/finanzen/protokoll" className="text-sm font-medium text-accent-700 hover:underline">
                Änderungsprotokoll ansehen
              </Link>
              <Link href="/einstellungen/verfahrensdokumentation" className="text-sm font-medium text-accent-700 hover:underline">
                Verfahrensdokumentation (GoBD)
              </Link>
            </div>
          </header>

          {!invoicesLoaded && <p role="status" className="mt-5 rounded-2xl bg-slate-100 p-3 text-sm text-slate-800">Wird geladen …</p>}
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <ReceiptText className="mt-0.5 h-5 w-5 shrink-0" />
            <p>Rechnungsentwürfe werden gespeichert, sind aber kein GoBD-konformes Rechnungsarchiv und erzeugen keine rechtsverbindliche E-Rechnung. Für den produktiven Versand sind ein geprüftes Archiv und eine E-Rechnungsschnittstelle erforderlich.</p>
          </div>

          <div className="mt-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
            <form onSubmit={saveInvoice} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-medium text-slate-900">Rechnungsentwurf</h2><p className="mt-1 text-sm text-slate-500">Positionen und Steuersatz festlegen</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">Entwurf</span></div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">Kunde
                  <select required disabled={!customersLoaded} value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <option value="">Kunden auswählen</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-700">Kennzeichen
                  <input readOnly value={customerVehicle?.plate ?? 'Wird aus der Kundenkartei übernommen'} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-500" />
                </label>
              </div>
              <div className="mt-5 space-y-3">
                {lines.map((line, index) => <div key={line.id} className="grid gap-3 rounded-2xl bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_100px_110px_130px_auto] sm:items-end">
                  <label className="text-xs font-medium text-slate-600">Position {index + 1}<input required value={line.description} onChange={(event) => updateLine(line.id, { description: event.target.value })} placeholder="Arbeitsleistung oder Ersatzteil" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm" /></label>
                  <label className="text-xs font-medium text-slate-600">Menge<input required type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm" /></label>
                  <label className="text-xs font-medium text-slate-600">Einheit<select value={line.unit ?? DEFAULT_UNIT} onChange={(event) => updateLine(line.id, { unit: event.target.value as UnitCode })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2.5 text-sm">{UNITS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
                  <label className="text-xs font-medium text-slate-600">Einzelpreis netto<input required type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => updateLine(line.id, { unitPrice: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm" /></label>
                  <button type="button" aria-label={`Position ${index + 1} entfernen`} onClick={() => removeLine(line.id)} className="h-10 rounded-lg px-3 text-sm font-medium text-rose-700 hover:bg-rose-50">Entfernen</button>
                </div>)}
              </div>
              <button type="button" onClick={addLine} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-accent-700 hover:bg-slate-200/70"><Plus className="h-4 w-4" />Position hinzufügen</button>
              <label className="mt-5 block text-sm font-medium text-slate-700">Steuerregel
                <select value={taxMode} onChange={(event) => setTaxMode(event.target.value as TaxMode)} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  {taxModes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                </select>
              </label>
              <dl className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Nettobetrag</dt><dd className="font-medium text-slate-800">{totals ? euro.format(totals.net) : '–'}</dd></div>
                {taxMode !== 'smallBusiness' && <div className="flex justify-between"><dt className="text-slate-500">Umsatzsteuer ({taxMode === 'standard19' ? '19' : '7'} %)</dt><dd className="font-medium text-slate-800">{totals ? euro.format(totals.tax) : '–'}</dd></div>}
                {taxMode === 'smallBusiness' && <p className="text-xs text-slate-500">Kein Umsatzsteuerausweis gemäß § 19 UStG.</p>}
                <div className="flex justify-between border-t border-slate-100 pt-3 text-base"><dt className="font-medium text-slate-900">Rechnungsbetrag</dt><dd className="font-medium text-slate-900">{totals ? euro.format(totals.gross) : '–'}</dd></div>
              </dl>
              <button disabled={!customersLoaded || !invoicesLoaded || !totals || customers.length === 0} type="submit" className="mt-5 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">Entwurf speichern</button>
            </form>

            <div className="space-y-5">
              <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <div className="flex items-center gap-2"><WalletCards className="h-5 w-5 text-accent-700" /><h2 className="text-lg font-medium text-slate-900">SEPA-Zahlungsdaten</h2></div>
                {bank.bankName && <p className="mt-3 text-sm text-slate-500">{bank.bankName}</p>}
                <p className="mt-2 break-all text-sm font-medium text-slate-800">{bank.iban || 'IBAN in den Einstellungen hinterlegen'}</p>
                {bank.bic && <p className="mt-1 text-sm text-slate-500">BIC: {bank.bic}</p>}
                <label className="mt-4 block text-sm font-medium text-slate-700">Offene Rechnung für Zahlungsdaten
                  <select value={paymentInvoice?.id ?? ''} onChange={(event) => setPaymentInvoiceId(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    {openInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number ?? 'Entwurf'} · {invoice.customer}</option>)}
                    {openInvoices.length === 0 && <option value="">Aktueller Entwurf</option>}
                  </select>
                </label>
                <p className="mt-3 text-sm text-slate-600">Überweisungsbetrag: <strong>{paymentAmount === null ? '–' : euro.format(paymentAmount)}</strong></p>
                {epcData && <textarea readOnly aria-label="SEPA-QR-Zahlungsdaten" value={epcData} rows={5} className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-600" />}
                <button type="button" onClick={() => void copyPaymentData()} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><Copy className="h-4 w-4" />EPC-Zahlungsdaten kopieren</button>
                <p className="mt-3 text-xs text-slate-500">Die EPC-Daten können in einer Banking-Anwendung für einen SEPA-Überweisungs-QR-Code verwendet werden.</p>
              </section>
              {/* The list scrolls on its own, so the form and the payment data stay where they are. */}
              <section className="flex max-h-[calc(100vh-3rem)] min-h-[20rem] flex-col rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <h2 className="text-lg font-medium text-slate-900">Zuletzt erstellte Rechnungen</h2>
                <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                  {invoices.length === 0 ? <p className="text-sm text-slate-500">Noch keine Rechnungsentwürfe vorhanden.</p> : invoices.map((invoice) => {
                    const invoiceTotal = getInvoiceTotals(invoice.lines, invoice.taxMode).gross;
                    const summary = summaryOf(invoice);
                    const badgeClass =
                      summary.kind === 'storno' || summary.kind === 'cancelled' ? 'bg-rose-50 text-rose-700'
                        : summary.overdueDays > 0 ? 'bg-rose-50 text-rose-700'
                          : summary.kind === 'paid' ? 'bg-emerald-50 text-emerald-700'
                            : summary.kind === 'draft' ? 'bg-slate-100 text-slate-700'
                              : 'bg-amber-50 text-amber-700';
                    return <article key={invoice.id} className="rounded-2xl border border-slate-200 p-3">
                      <div className="flex justify-between gap-2"><div><p className="font-medium text-slate-900">{invoice.number ?? 'Entwurf'}</p><p className="text-xs text-slate-500">{invoice.customer} · {invoice.plate}</p></div><p className="font-medium text-slate-900">{euro.format(invoiceTotal)}</p></div>
                      {summary.kind === 'partial' && <p className="mt-1 text-xs text-slate-600">Bezahlt {formatEuro(summary.paidCents)} · noch offen <strong>{formatEuro(summary.openCents)}</strong></p>}
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badgeClass}`}>
                          {summary.kind === 'storno'
                            ? `Storno zu ${invoice.cancelsNumber ?? 'Rechnung'}`
                            : summary.kind === 'cancelled'
                              ? `Storniert${invoice.cancelledByNumber ? ` (${invoice.cancelledByNumber})` : ''}`
                              : paymentLabel(summary, invoice.dueAt)}
                        </span>
                        <div className="flex flex-wrap items-center justify-end gap-3">
                          <Link href={`/finanzen/${invoice.id}/druck`} className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:underline">
                            <Printer className="h-3.5 w-3.5" />Druckansicht
                          </Link>
                          {invoice.number && <a href={`/finanzen/${invoice.id}/einvoice?format=pdf`} download className="text-xs font-medium text-slate-700 hover:underline">ZUGFeRD-PDF</a>}
                          {invoice.number && <a href={`/finanzen/${invoice.id}/einvoice`} download className="text-xs font-medium text-slate-700 hover:underline">XML</a>}
                          {invoice.status === 'draft' && <button type="button" onClick={() => void issueDraft(invoice)} className="text-xs font-medium text-accent-700 hover:underline">Rechnung ausstellen</button>}
                          {summary.openCents > 0 && <button type="button" onClick={() => void markPaid(invoice)} className="inline-flex items-center gap-1 text-xs font-medium text-accent-700 hover:underline"><CheckCircle2 className="h-3.5 w-3.5" />{summary.kind === 'partial' ? 'Rest als bezahlt markieren' : 'Als bezahlt markieren'}</button>}
                          {summary.openCents > 0 && <button type="button" onClick={() => setInvoiceToPay(invoice)} className="text-xs font-medium text-accent-700 hover:underline">Zahlung erfassen</button>}
                          {summary.overdueDays > 0 && <button type="button" onClick={() => setInvoiceToRemind(invoice)} className="text-xs font-medium text-amber-700 hover:underline">Mahnung vorbereiten</button>}
                          {(invoice.status === 'issued' || invoice.status === 'paid') && !invoice.cancelsInvoiceId && <button type="button" onClick={() => setInvoiceToCancel(invoice)} className="text-xs font-medium text-rose-700 hover:underline">Stornieren</button>}
                        </div>
                      </div>
                    </article>;
                  })}
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>

      {invoiceToPay && (
        <PaymentDialog
          invoiceNumber={invoiceToPay.number ?? 'Rechnung'}
          customer={invoiceToPay.customer}
          grossCents={summaryOf(invoiceToPay).grossCents}
          paidCents={summaryOf(invoiceToPay).paidCents}
          openCents={summaryOf(invoiceToPay).openCents}
          today={today}
          onSubmit={async (amountCents, paidAt) => {
            const failure = await recordPayment(invoiceToPay, amountCents, paidAt);
            if (!failure) setInvoiceToPay(null);
            return failure;
          }}
          onClose={() => setInvoiceToPay(null)}
        />
      )}

      {invoiceToRemind && invoiceToRemind.dueAt && (
        <ReminderDialog
          sellerName={invoiceToRemind.sellerSnapshot.companyName}
          customerName={invoiceToRemind.buyerSnapshot.name}
          customerEmail={invoiceToRemind.buyerSnapshot.email}
          invoiceNumber={invoiceToRemind.number ?? 'Rechnung'}
          dueDate={invoiceToRemind.dueAt}
          grossCents={summaryOf(invoiceToRemind).grossCents}
          openCents={summaryOf(invoiceToRemind).openCents}
          overdueDays={summaryOf(invoiceToRemind).overdueDays}
          today={today}
          onClose={() => setInvoiceToRemind(null)}
        />
      )}

      {noticeText && noticeText !== dismissedNotice && (
        <div
          role={isErrorNotice ? 'alert' : 'status'}
          className={`fixed bottom-6 left-1/2 z-[70] flex max-w-[min(92vw,34rem)] -translate-x-1/2 items-start gap-3 rounded-2xl px-4 py-3 text-sm shadow-2xl ${isErrorNotice ? 'bg-rose-700 text-white' : 'bg-slate-900 text-white'}`}
        >
          <p>{noticeText}</p>
          <button
            type="button"
            onClick={() => setDismissedNotice(noticeText)}
            aria-label="Meldung schließen"
            className="shrink-0 rounded-lg p-0.5 text-white/70 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {invoiceToCancel && (
        <ConfirmDialog
          title={`Rechnung ${invoiceToCancel.number ?? ''} stornieren?`}
          message={`Es wird eine Stornorechnung mit eigener Nummer erstellt, die alle Positionen mit negativem Betrag enthält (${euro.format(getInvoiceTotals(invoiceToCancel.lines, invoiceToCancel.taxMode).gross)} wird ausgeglichen). Die Rechnung selbst bleibt unverändert und wird als storniert gekennzeichnet. Das kann nicht rückgängig gemacht werden.${invoiceToCancel.paidAmount > 0 ? ' Bereits erfasste Zahlungen bleiben bestehen und müssen separat erstattet werden.' : ''}`}
          confirmLabel="Stornorechnung erstellen"
          onCancel={() => setInvoiceToCancel(null)}
          onConfirm={() => void confirmCancel()}
        />
      )}
    </div>
  );
}
