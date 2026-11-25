'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Disc3, Mail, MessageSquareText } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import { getDateStringInTimeZone, INVOICE_TIME_ZONE } from '../../lib/date';
import { useCustomers } from '../../lib/hooks/useCustomers';
import { useTireStorage } from '../../lib/hooks/useTireStorage';
import { useWorkshopSettings } from '../../lib/hooks/useWorkshopSettings';
import { canSendReminder, withOptOutNotice } from '../../lib/reminder-consent';
import { DEFAULT_WORKSHOP_NAME, getMailtoLink, getWhatsAppLink } from '../../lib/reminders';
import {
  buildTireReminderMessage,
  formatTreadDepth,
  isSeasonalReminderDue,
  isTireSeason,
  isTreadLow,
  MAX_SLOT_LENGTH,
  MAX_TIRE_LABEL_LENGTH,
  TIRE_SEASON_LABELS,
  TIRE_SEASONS,
  type TireSeason,
} from '../../lib/tire-storage';

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('de-DE').format(new Date(`${date}T00:00:00`));
}

const inputClass =
  'mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white';

export default function TireStoragePage() {
  const { customers, vehicles, isLoaded: customersLoaded } = useCustomers();
  const { sets, isLoaded, error, addSet, releaseSet, markReminderSent } = useTireStorage();
  const { settings } = useWorkshopSettings();
  const workshopName = settings.companyName || DEFAULT_WORKSHOP_NAME;
  const today = getDateStringInTimeZone(new Date(), INVOICE_TIME_ZONE);

  const [customerId, setCustomerId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [slot, setSlot] = useState('');
  const [season, setSeason] = useState<TireSeason>('winter');
  const [description, setDescription] = useState('');
  const [treadMm, setTreadMm] = useState('');
  const [storedAt, setStoredAt] = useState(today);
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const customersById = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);
  const vehiclesById = useMemo(() => new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])), [vehicles]);
  const customerVehicles = vehicles.filter((vehicle) => vehicle.customerId === customerId);
  const active = sets.filter((set) => !set.releasedAt);
  const history = sets.filter((set) => set.releasedAt);
  const due = active.filter((set) => isSeasonalReminderDue(set, today));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    let treadDepthTenthMm: number | undefined;
    if (treadMm.trim()) {
      const parsed = Number(treadMm.replace(',', '.'));
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 15) {
        setFormError('Die Profiltiefe muss zwischen 0 und 15 mm liegen.');
        return;
      }
      treadDepthTenthMm = Math.round(parsed * 10);
    }
    setSaving(true);
    try {
      const saved = await addSet({
        customerId,
        vehicleId: vehicleId || undefined,
        slot,
        season,
        description,
        treadDepthTenthMm,
        storedAt,
        notes: notes || undefined,
      });
      if (saved) {
        setSlot('');
        setDescription('');
        setTreadMm('');
        setNotes('');
        setVehicleId('');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 md:h-screen md:overflow-hidden">
      <div className="flex flex-col md:h-full md:flex-row">
        <Sidebar />

        <main className="wp-stagger min-w-0 flex-1 bg-slate-50 px-4 py-6 md:h-full md:overflow-y-auto lg:px-10 lg:py-8">
          <header className="border-b border-slate-200 pb-6">
            <p className="text-sm font-medium text-slate-500">Lager</p>
            <h1 className="mt-2 text-3xl font-medium tracking-tight text-slate-900">Reifenlager</h1>
            <p className="mt-1 text-sm text-slate-500">Eingelagerte Räder, Lagerplätze und Saison-Erinnerungen</p>
          </header>
          {error && (
            <p role="alert" className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">
              {error}
            </p>
          )}

          <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-lg font-medium text-slate-900">Saison-Erinnerungen</h2>
            <p className="mt-1 text-sm text-slate-500">
              Winterreifen: Oktober und November. Sommerreifen: März und April. Je Saison einmal pro Satz.
            </p>
            {!isLoaded ? (
              <p className="mt-4 text-sm text-slate-500">Wird geladen …</p>
            ) : due.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">Aktuell sind keine Erinnerungen fällig.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {due.map((set) => {
                  const customer = customersById.get(set.customerId);
                  if (!customer) return null;
                  const plate = (set.vehicleId && vehiclesById.get(set.vehicleId)?.plate) || '';
                  const message = withOptOutNotice(
                    buildTireReminderMessage({ customerName: customer.name, season: set.season, plate, workshopName }),
                  );
                  const whatsappLink = getWhatsAppLink(customer.phone, message);
                  const emailLink = customer.email
                    ? getMailtoLink(customer.email, `Erinnerung: Räderwechsel (${TIRE_SEASON_LABELS[set.season]})`, message)
                    : null;
                  return (
                    <li key={set.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="font-medium text-slate-900">
                        {customer.name} · {TIRE_SEASON_LABELS[set.season]} · Platz {set.slot}
                      </p>
                      {canSendReminder(customer) ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {whatsappLink && (
                            <a
                              href={whatsappLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => void markReminderSent(set.id)}
                              className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                            >
                              <MessageSquareText className="h-4 w-4" />
                              WhatsApp
                            </a>
                          )}
                          {emailLink && (
                            <a
                              href={emailLink}
                              onClick={() => void markReminderSent(set.id)}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <Mail className="h-4 w-4" />
                              E-Mail
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => void markReminderSent(set.id)}
                            className="rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-accent-700 hover:bg-slate-200/70"
                          >
                            Als kontaktiert markieren
                          </button>
                        </div>
                      ) : (
                        <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                          Keine gültige Einwilligung für Erinnerungen. Bitte zuerst unter „Wiedervorlage / TÜV“ erfassen.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-lg font-medium text-slate-900">Neuen Satz einlagern</h2>
            <form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">
                Kunde
                <select
                  required
                  value={customerId}
                  onChange={(event) => {
                    setCustomerId(event.target.value);
                    setVehicleId('');
                  }}
                  className={inputClass}
                >
                  <option value="">{customersLoaded ? 'Bitte wählen' : 'Wird geladen …'}</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Fahrzeug (optional)
                <select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} className={inputClass}>
                  <option value="">Kein Fahrzeug</option>
                  {customerVehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.plate} · {vehicle.make}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Lagerplatz
                <input
                  required
                  value={slot}
                  maxLength={MAX_SLOT_LENGTH}
                  onChange={(event) => setSlot(event.target.value)}
                  placeholder="z. B. A-3-2"
                  className={inputClass}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Saison
                <select
                  value={season}
                  onChange={(event) => {
                    if (isTireSeason(event.target.value)) setSeason(event.target.value);
                  }}
                  className={inputClass}
                >
                  {TIRE_SEASONS.map((option) => (
                    <option key={option} value={option}>
                      {TIRE_SEASON_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700 md:col-span-2">
                Beschreibung
                <input
                  required
                  value={description}
                  maxLength={MAX_TIRE_LABEL_LENGTH}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="z. B. 205/55 R16 Continental auf Alufelgen"
                  className={inputClass}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Profiltiefe in mm (optional)
                <input
                  value={treadMm}
                  inputMode="decimal"
                  onChange={(event) => setTreadMm(event.target.value)}
                  placeholder="z. B. 6,5"
                  className={inputClass}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Eingelagert am
                <input required type="date" value={storedAt} onChange={(event) => setStoredAt(event.target.value)} className={inputClass} />
              </label>
              <label className="block text-sm font-medium text-slate-700 md:col-span-2">
                Notiz (optional)
                <input value={notes} onChange={(event) => setNotes(event.target.value)} className={inputClass} />
              </label>
              {formError && (
                <p role="alert" className="text-sm text-rose-700 md:col-span-2">
                  {formError}
                </p>
              )}
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Einlagern
                </button>
              </div>
            </form>
          </section>

          <section className="mt-6 space-y-3">
            <h2 className="text-lg font-medium text-slate-900">Im Lager ({active.length})</h2>
            {active.length === 0 ? (
              <div className="rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
                <Disc3 className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-3 text-sm text-slate-600">Noch keine Reifen eingelagert.</p>
              </div>
            ) : (
              active.map((set) => (
                <article key={set.id} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-lg font-medium text-slate-900">Platz {set.slot}</p>
                      <p className="mt-1 text-sm text-slate-700">
                        {customersById.get(set.customerId)?.name ?? 'Unbekannter Kunde'}
                        {set.vehicleId && vehiclesById.get(set.vehicleId) ? ` · ${vehiclesById.get(set.vehicleId)?.plate}` : ''}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {TIRE_SEASON_LABELS[set.season]} · {set.description} · seit {formatDate(set.storedAt)}
                      </p>
                      {set.treadDepthTenthMm !== undefined && (
                        <p
                          className={`mt-1 text-sm ${isTreadLow(set.season, set.treadDepthTenthMm) ? 'font-medium text-rose-700' : 'text-slate-500'}`}
                        >
                          Profiltiefe {formatTreadDepth(set.treadDepthTenthMm)}
                          {isTreadLow(set.season, set.treadDepthTenthMm) ? ' – bald ersetzen' : ''}
                        </p>
                      )}
                      {set.notes && <p className="mt-1 text-sm text-slate-500">{set.notes}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Satz auf Platz ${set.slot} als ausgelagert markieren?`)) void releaseSet(set.id);
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Auslagern
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>

          {history.length > 0 && (
            <details className="mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">
                Ausgelagert ({history.length})
              </summary>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                {history.map((set) => (
                  <li key={set.id}>
                    {customersById.get(set.customerId)?.name ?? 'Unbekannter Kunde'} · {TIRE_SEASON_LABELS[set.season]} · Platz{' '}
                    {set.slot} · {formatDate(set.storedAt)} bis {set.releasedAt ? formatDate(set.releasedAt) : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </main>
      </div>
    </div>
  );
}
