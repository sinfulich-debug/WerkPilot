'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { formatEuro, parseEuroToCents } from '../../lib/money';

type PaymentDialogProps = {
  invoiceNumber: string;
  customer: string;
  grossCents: number;
  paidCents: number;
  openCents: number;
  /** Today in the workshop's time zone (YYYY-MM-DD). */
  today: string;
  /** Returns null on success or the German error message. */
  onSubmit: (amountCents: number, paidAt: string) => Promise<string | null>;
  onClose: () => void;
};

const FIELD =
  'mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white';

/** "75,20" for the input field, without thousands separators or the currency sign. */
function toInputAmount(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

export default function PaymentDialog({
  invoiceNumber,
  customer,
  grossCents,
  paidCents,
  openCents,
  today,
  onSubmit,
  onClose,
}: PaymentDialogProps) {
  const [amount, setAmount] = useState(toInputAmount(openCents));
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSaving, onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    let cents: number;
    try {
      cents = parseEuroToCents(amount);
    } catch {
      setError('Bitte gib einen gültigen Betrag mit höchstens zwei Nachkommastellen ein, z. B. 75,20.');
      return;
    }
    if (cents <= 0) {
      setError('Der Zahlungsbetrag muss größer als 0 sein.');
      return;
    }
    if (cents > openCents) {
      setError(`Der Betrag ist höher als der offene Rechnungsbetrag von ${formatEuro(openCents)}.`);
      return;
    }
    if (!date || date > today) {
      setError('Das Zahlungsdatum darf nicht in der Zukunft liegen.');
      return;
    }

    setIsSaving(true);
    const failure = await onSubmit(cents, new Date(`${date}T12:00:00`).toISOString());
    setIsSaving(false);
    if (failure) setError(failure);
  };

  return (
    <div className="wp-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center overflow-y-auto bg-slate-950/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-dialog-title"
        className="wp-sheet mt-auto sm:my-auto w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="payment-dialog-title" className="text-xl font-medium text-slate-900">
              Zahlung erfassen
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {invoiceNumber} · {customer}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-3 rounded-2xl bg-slate-50 p-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Rechnungsbetrag</dt>
            <dd className="font-medium text-slate-900">{formatEuro(grossCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Bereits bezahlt</dt>
            <dd className="font-medium text-slate-900">{formatEuro(paidCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Noch offen</dt>
            <dd className="font-medium text-slate-900">{formatEuro(openCents)}</dd>
          </div>
        </dl>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            Betrag (€)
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className={FIELD}
              autoFocus
              required
            />
          </label>
          <button
            type="button"
            onClick={() => setAmount(toInputAmount(openCents))}
            className="text-xs font-medium text-accent-700 hover:underline"
          >
            Gesamten offenen Betrag einsetzen ({formatEuro(openCents)})
          </button>

          <label className="block text-sm font-medium text-slate-700">
            Zahlungsdatum
            <input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} className={FIELD} required />
          </label>

          {error && (
            <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {isSaving ? 'Speichern…' : 'Zahlung speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
