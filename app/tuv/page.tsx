'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, Mail, MessageSquareText, Phone, Search } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import Plate from '../../components/Plate';
import { getTuvStatus, type Customer, type TuvStatus, type Vehicle } from '../../lib/customers';
import { useCustomers } from '../../lib/hooks/useCustomers';
import { useWorkshopSettings } from '../../lib/hooks/useWorkshopSettings';
import {
  CONSENT_SOURCE_LABELS,
  CONSENT_SOURCES,
  canSendReminder,
  getReminderConsentState,
  isConsentSource,
  withOptOutNotice,
  type ConsentSource,
} from '../../lib/reminder-consent';
import {
  buildTuvReminderMessage,
  DEFAULT_WORKSHOP_NAME,
  getMailtoLink,
  getWhatsAppLink,
  renderReminderTemplate,
} from '../../lib/reminders';

type TuvFilter = 'all' | 'overdue' | 'soon';
type Reminder = {
  customer: Customer;
  vehicle: Vehicle;
  status: Exclude<TuvStatus, 'ok'>;
  daysUntilDue: number;
};

const filters: { value: TuvFilter; label: string }[] = [
  { value: 'all', label: 'Alle' },
  { value: 'overdue', label: 'TÜV überfällig' },
  { value: 'soon', label: 'TÜV bald fällig (30 Tage)' },
];

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('de-DE').format(new Date(`${date}T00:00:00`));
}

function getTuvBadge(status: Reminder['status'], daysUntilDue: number): { label: string; className: string } {
  if (status === 'overdue') {
    const days = Math.abs(daysUntilDue);
    return {
      label: `seit ${days} ${days === 1 ? 'Tag' : 'Tagen'}`,
      className: 'bg-rose-100 text-rose-700',
    };
  }
  return {
    label: daysUntilDue === 0 ? 'heute fällig' : `in ${daysUntilDue} ${daysUntilDue === 1 ? 'Tag' : 'Tagen'}`,
    className: 'bg-amber-100 text-amber-700',
  };
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(value));
}

function ConsentControls({
  customer,
  onConsent,
  onOptOut,
}: {
  customer: Customer;
  onConsent: (customerId: string, source: ConsentSource) => Promise<boolean>;
  onOptOut: (customerId: string) => Promise<boolean>;
}) {
  const [source, setSource] = useState<ConsentSource>('verbal');
  const [busy, setBusy] = useState(false);
  const state = getReminderConsentState(customer);
  const run = async (action: () => Promise<boolean>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  if (state === 'granted') {
    const sourceLabel = customer.reminderConsentSource ? CONSENT_SOURCE_LABELS[customer.reminderConsentSource] : 'erfasst';
    const dateLabel = customer.reminderConsentAt ? ` am ${formatDateTime(customer.reminderConsentAt)}` : '';
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-500">
        <span>Einwilligung: {sourceLabel}{dateLabel}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => onOptOut(customer.id))}
          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
        >
          Abmeldung (STOP) erfassen
        </button>
      </div>
    );
  }

  const headline =
    state === 'revoked'
      ? `Abgemeldet${customer.reminderOptOutAt ? ` am ${formatDateTime(customer.reminderOptOutAt)}` : ''}. Es werden keine Erinnerungen gesendet.`
      : 'Keine Einwilligung erfasst. Erinnerungen sind gesperrt.';

  return (
    <div className="mt-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-medium">{headline}</p>
      <p className="mt-1">Erst senden, wenn der Kunde zugestimmt hat. Die Zustimmung bitte hier festhalten.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={source}
          onChange={(event) => {
            if (isConsentSource(event.target.value)) setSource(event.target.value);
          }}
          aria-label="Wie wurde zugestimmt?"
          className="rounded-xl border border-amber-200 bg-white px-3 py-1.5 text-xs text-slate-900"
        >
          {CONSENT_SOURCES.map((option) => (
            <option key={option} value={option}>
              {CONSENT_SOURCE_LABELS[option]}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => onConsent(customer.id, source))}
          className="rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
        >
          Einwilligung erfassen
        </button>
      </div>
    </div>
  );
}

export default function TuvRemindersPage() {
  const { customers, vehicles, isLoaded, markReminderSent, recordReminderConsent, recordReminderOptOut } = useCustomers();
  const { settings, error: settingsError } = useWorkshopSettings();
  const workshopName = settings.companyName || DEFAULT_WORKSHOP_NAME;
  const reminderTemplate = settings.whatsappTemplate;
  const hasCustomTemplate = settings.hasCustomTemplate;
  const templateError = settingsError
    ? `${settingsError} Es wird die Standardvorlage verwendet.`
    : '';
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TuvFilter>('all');

  const reminders = useMemo(() => {
    const customersById = new Map(customers.map((customer) => [customer.id, customer]));

    return vehicles
      .flatMap((vehicle) => {
        const customer = customersById.get(vehicle.customerId);
        if (!customer) return [];

        const { status, daysUntilDue } = getTuvStatus(vehicle.tuvDueDate);
        if (status === 'ok') return [];
        return [{ customer, vehicle, status, daysUntilDue }];
      })
      .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  }, [customers, vehicles]);

  const overdueCount = reminders.filter((reminder) => reminder.status === 'overdue').length;
  const soonCount = reminders.filter((reminder) => reminder.status === 'soon').length;

  const filteredReminders = useMemo(() => {
    const searchTerm = search.trim().toLocaleLowerCase('de-DE');
    return reminders.filter((reminder) => {
      const matchesFilter = filter === 'all' || reminder.status === filter;
      const matchesSearch =
        searchTerm.length === 0 ||
        [
          reminder.customer.name,
          reminder.customer.phone,
          reminder.vehicle.plate,
          reminder.vehicle.make,
        ].some((value) => value.toLocaleLowerCase('de-DE').includes(searchTerm));
      return matchesFilter && matchesSearch;
    });
  }, [filter, reminders, search]);

  return (
    <div className="min-h-screen bg-slate-100 md:h-screen md:overflow-hidden">
      <div className="flex flex-col md:h-full md:flex-row">
        <Sidebar />

        <main className="wp-stagger min-w-0 flex-1 bg-slate-50 px-4 py-6 md:h-full md:overflow-y-auto lg:px-10 lg:py-8">
          <header className="border-b border-slate-200 pb-6">
            <p className="text-sm font-medium text-slate-500">Erinnerungen</p>
            <h1 className="mt-2 text-3xl font-medium tracking-tight text-slate-900">Wiedervorlage / TÜV</h1>
            <p className="mt-1 text-sm text-slate-500">Fahrzeuge mit fälligem oder überfälligem TÜV</p>
          </header>
          {templateError && <p role="alert" className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">{templateError}</p>}

          <section className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">Überfällig</p>
              <p className="mt-2 text-3xl font-medium text-rose-700">{overdueCount}</p>
              <p className="mt-1 text-sm text-slate-500">Fahrzeuge benötigen eine Erinnerung</p>
            </div>
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-sm text-slate-500">Bald fällig (30 Tage)</p>
              <p className="mt-2 text-3xl font-medium text-amber-700">{soonCount}</p>
              <p className="mt-1 text-sm text-slate-500">Fahrzeuge im anstehenden Zeitraum</p>
            </div>
          </section>

          <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
              <label className="relative block text-sm font-medium text-slate-700">
                Suche
                <Search className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Kunde, Kennzeichen oder Fahrzeug"
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                TÜV-Status
                <select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as TuvFilter)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                >
                  {filters.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="mt-6 space-y-4">
            {!isLoaded ? (
              <div className="rounded-3xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
                Wird geladen …
              </div>
            ) : reminders.length === 0 ? (
              <div className="rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
                <CalendarDays className="mx-auto h-8 w-8 text-emerald-500" />
                <p className="mt-3 text-sm font-medium text-slate-700">
                  Keine fälligen TÜV-Termine – alles in Ordnung.
                </p>
              </div>
            ) : filteredReminders.length === 0 ? (
              <div className="rounded-3xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
                Keine Fahrzeuge gefunden.
              </div>
            ) : (
              filteredReminders.map(({ customer, vehicle, status, daysUntilDue }) => {
                const formattedDueDate = formatDate(vehicle.tuvDueDate);
                const canSend = canSendReminder(customer);
                const message = withOptOutNotice(hasCustomTemplate
                  ? renderReminderTemplate(reminderTemplate, {
                      customerName: customer.name,
                      vehicleMake: vehicle.make,
                      plate: vehicle.plate,
                      tuvDueDate: formattedDueDate,
                    })
                  : buildTuvReminderMessage({
                      customerName: customer.name,
                      vehicleMake: vehicle.make,
                      plate: vehicle.plate,
                      tuvDueDate: vehicle.tuvDueDate,
                      daysUntilDue,
                      workshopName,
                    }));
                const whatsappLink = getWhatsAppLink(customer.phone, message);
                const emailSubject = `Erinnerung: Hauptuntersuchung (TÜV) für ${vehicle.plate}`;
                const emailLink = getMailtoLink(customer.email, emailSubject, message);
                const badge = getTuvBadge(status, daysUntilDue);
                const phoneForCall = customer.phone.replace(/[^\d+]/g, '');
                const smsLink = phoneForCall ? `sms:${phoneForCall}?body=${encodeURIComponent(message)}` : null;

                return (
                  <article
                    key={vehicle.id}
                    className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
                  >
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <h2 className="text-xl font-medium text-slate-900">{customer.name}</h2>
                        <div className="mt-2 flex flex-col gap-2 text-sm text-slate-500 sm:flex-row sm:flex-wrap sm:gap-4">
                          <span className="inline-flex items-center gap-2">
                            <Phone className="h-4 w-4" />
                            {customer.phone}
                          </span>
                          <span className="inline-flex items-center gap-2 break-all">
                            <Mail className="h-4 w-4 shrink-0" />
                            {customer.email}
                          </span>
                        </div>

                        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="font-medium text-slate-900">{vehicle.make}</p>
                          <Plate value={vehicle.plate} className="mt-1.5" />
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="text-sm text-slate-600">
                              TÜV fällig bis {formatDate(vehicle.tuvDueDate)}
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                          </div>
                        </div>

                        <p className="mt-3 text-sm text-slate-500">
                          Zuletzt kontaktiert:{' '}
                          {vehicle.lastReminderSentAt
                            ? formatDate(vehicle.lastReminderSentAt)
                            : 'Noch nicht kontaktiert'}
                        </p>
                        <ConsentControls
                          customer={customer}
                          onConsent={recordReminderConsent}
                          onOptOut={recordReminderOptOut}
                        />
                      </div>

                      {canSend && (
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        {whatsappLink ? (
                          <a
                            href={whatsappLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => markReminderSent(vehicle.id)}
                            className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                          >
                            <MessageSquareText className="h-4 w-4" />
                            WhatsApp
                          </a>
                        ) : (
                          <button
                            type="button"
                            disabled
                            title="Telefonnummer ungültig"
                            className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 opacity-50"
                          >
                            <MessageSquareText className="h-4 w-4" />
                            WhatsApp
                          </button>
                        )}
                        {smsLink && (
                          <a
                            href={smsLink}
                            onClick={() => markReminderSent(vehicle.id)}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-accent-700 hover:bg-slate-200/70"
                          >
                            <MessageSquareText className="h-4 w-4" />
                            SMS
                          </a>
                        )}
                        <a
                          href={emailLink}
                          onClick={() => markReminderSent(vehicle.id)}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Mail className="h-4 w-4" />
                          E-Mail
                        </a>
                        <a
                          href={`tel:${phoneForCall}`}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Phone className="h-4 w-4" />
                          Anrufen
                        </a>
                        <button
                          type="button"
                          onClick={() => markReminderSent(vehicle.id)}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-accent-700 hover:bg-slate-200/70"
                        >
                          Als kontaktiert markieren
                        </button>
                      </div>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
