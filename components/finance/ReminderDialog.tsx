'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  buildReminderDraft,
  REMINDER_LEVEL_LABEL,
  suggestReminderLevel,
  type ReminderLevel,
} from '../../lib/payment-reminder';

type ReminderDialogProps = {
  sellerName: string;
  customerName: string;
  customerEmail: string | null;
  invoiceNumber: string;
  dueDate: string;
  grossCents: number;
  openCents: number;
  overdueDays: number;
  today: string;
  onClose: () => void;
};

const LEVELS: ReminderLevel[] = ['reminder', 'first', 'second'];

export default function ReminderDialog({
  sellerName,
  customerName,
  customerEmail,
  invoiceNumber,
  dueDate,
  grossCents,
  openCents,
  overdueDays,
  today,
  onClose,
}: ReminderDialogProps) {
  const [level, setLevel] = useState<ReminderLevel>(suggestReminderLevel(overdueDays));
  const [graceDays, setGraceDays] = useState(7);
  const [copyNotice, setCopyNotice] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const draft = useMemo(
    () =>
      buildReminderDraft({ level, sellerName, customerName, invoiceNumber, dueDate, grossCents, openCents, today, graceDays }),
    [level, sellerName, customerName, invoiceNumber, dueDate, grossCents, openCents, today, graceDays],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
      setCopyNotice('Der Text wurde kopiert.');
    } catch (error) {
      console.error('Der Mahntext konnte nicht kopiert werden.', error);
      setCopyNotice('Kopieren nicht möglich. Markiere den Text und kopiere ihn manuell.');
    }
  };

  const mailto = customerEmail
    ? `mailto:${encodeURIComponent(customerEmail)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`
    : null;

  return (
    <div className="wp-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center overflow-y-auto bg-slate-950/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reminder-dialog-title"
        className="wp-sheet mt-auto sm:my-auto w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="reminder-dialog-title" className="text-xl font-medium text-slate-900">
              Mahnung vorbereiten
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {invoiceNumber} · {customerName} · seit {overdueDays} {overdueDays === 1 ? 'Tag' : 'Tagen'} überfällig
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

        <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          Das ist nur ein Entwurf zum Kopieren. Es wird nichts verschickt oder gespeichert. Mahngebühren und Verzugszinsen sind
          nicht enthalten; prüfe den Text vor dem Versand.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            Stufe
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value as ReminderLevel)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
            >
              {LEVELS.map((item) => (
                <option key={item} value={item}>
                  {REMINDER_LEVEL_LABEL[item]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Neue Frist
            <select
              value={graceDays}
              onChange={(event) => setGraceDays(Number(event.target.value))}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
            >
              {[7, 10, 14].map((days) => (
                <option key={days} value={days}>
                  {days} Tage ab heute
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="mt-4 text-sm font-medium text-slate-900">Betreff: {draft.subject}</p>
        <textarea
          readOnly
          aria-label="Text der Mahnung"
          value={draft.body}
          rows={13}
          className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800"
        />

        {copyNotice && (
          <p role="status" className="mt-2 text-xs font-medium text-emerald-700">
            {copyNotice}
          </p>
        )}

        <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Schließen
          </button>
          {mailto && (
            <a
              href={mailto}
              className="rounded-2xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-center text-sm font-medium text-accent-700 hover:bg-slate-200/70"
            >
              In E-Mail-Programm öffnen
            </a>
          )}
          <button
            type="button"
            onClick={() => void copy()}
            className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Text kopieren
          </button>
        </div>
      </div>
    </div>
  );
}
