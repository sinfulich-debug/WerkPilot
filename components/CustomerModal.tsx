'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import type { Customer, CustomerInput } from '../lib/customers';

type CustomerModalProps = {
  customer: Customer | null;
  error: string | null;
  onClose: () => void;
  onSave: (input: CustomerInput) => void | Promise<void>;
};

export default function CustomerModal({ customer, error, onClose, onSave }: CustomerModalProps) {
  const [formState, setFormState] = useState<CustomerInput>(() => ({
    name: customer?.name ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    notes: customer?.notes ?? '',
  }));
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formState.name.trim()) {
      setValidationError('Der Name darf nicht leer sein.');
      return;
    }
    if (!formState.phone.trim()) {
      setValidationError('Die Telefonnummer darf nicht leer sein.');
      return;
    }

    const email = formState.email.trim();
    if (email && !email.includes('@')) {
      setValidationError('Bitte gib eine gültige E-Mail-Adresse ein oder lasse das Feld leer.');
      return;
    }

    setValidationError(null);
    onSave({ ...formState, email });
  };

  return (
    <div className="wp-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center overflow-y-auto bg-slate-950/40 p-4">
      <div className="wp-sheet mt-auto sm:my-auto max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-500">
              {customer ? 'Kunde bearbeiten' : 'Neuer Kunde'}
            </p>
            <h2 className="mt-2 text-2xl font-medium text-slate-900">
              {customer ? 'Kundendaten bearbeiten' : 'Kunden anlegen'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form noValidate onSubmit={handleSubmit} className="mt-6 space-y-5">
          <label className="block text-sm font-medium text-slate-700">
            Name
            <input
              value={formState.name}
              onChange={(event) => {
                setValidationError(null);
                setFormState((current) => ({ ...current, name: event.target.value }));
              }}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
              placeholder="z. B. Anna Müller"
              required
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Telefon
              <input
                type="tel"
                value={formState.phone}
                onChange={(event) => {
                  setValidationError(null);
                  setFormState((current) => ({ ...current, phone: event.target.value }));
                }}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                placeholder="+49 711 123456"
                required
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              E-Mail (optional)
              <input
                type="email"
                name="email"
                value={formState.email}
                onChange={(event) => {
                  setValidationError(null);
                  setFormState((current) => ({ ...current, email: event.target.value }));
                }}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                placeholder="name@beispiel.de"
              />
            </label>
          </div>

          {(validationError || error) && (
            <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {validationError ?? error}
            </p>
          )}

          <label className="block text-sm font-medium text-slate-700">
            Notizen (optional)
            <textarea
              value={formState.notes ?? ''}
              onChange={(event) => setFormState((current) => ({ ...current, notes: event.target.value }))}
              rows={3}
              className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
              placeholder="Zusätzliche Informationen zum Kunden"
            />
          </label>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              {customer ? 'Änderungen speichern' : 'Kunde speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
