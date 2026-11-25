'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import {
  centsToEuros,
  DEFAULT_WHATSAPP_TEMPLATE,
  eurosToCentsOrNull,
  parseHourlyRateCents,
} from '../../lib/workshop-settings';

type TaxMode = 'standard19' | 'reduced7' | 'smallBusiness';
type Weekday = 'Montag' | 'Dienstag' | 'Mittwoch' | 'Donnerstag' | 'Freitag' | 'Samstag' | 'Sonntag';
type OpeningTime = { closed: boolean; open: string; close: string };
type OpeningHours = Record<Weekday, OpeningTime>;
type WorkshopModules = {
  fahrzeugpruefung: boolean;
  digitaleRechnungen: boolean;
  lagerverwaltung: boolean;
  betriebsberichte: boolean;
};
type WorkshopSettings = {
  companyName: string;
  ownerName: string;
  street: string;
  postalCode: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  taxNumber: string;
  vatId: string;
  bankName: string;
  iban: string;
  bic: string;
  hourlyRate: number;
  invoiceFooter: string;
  whatsappTemplate: string;
  taxMode: TaxMode;
  openingHours: OpeningHours;
  modules: WorkshopModules;
};

const weekdays: Weekday[] = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const initialOpeningHours: OpeningHours = {
  Montag: { closed: false, open: '08:00', close: '17:00' },
  Dienstag: { closed: false, open: '08:00', close: '17:00' },
  Mittwoch: { closed: false, open: '08:00', close: '17:00' },
  Donnerstag: { closed: false, open: '08:00', close: '17:00' },
  Freitag: { closed: false, open: '08:00', close: '16:00' },
  Samstag: { closed: true, open: '09:00', close: '12:00' },
  Sonntag: { closed: true, open: '09:00', close: '12:00' },
};

const DEFAULT_SETTINGS: WorkshopSettings = {
  companyName: '',
  ownerName: '',
  street: '',
  postalCode: '',
  city: '',
  phone: '',
  email: '',
  website: '',
  taxNumber: '',
  vatId: '',
  bankName: '',
  iban: '',
  bic: '',
  hourlyRate: 95,
  invoiceFooter: 'Zahlbar innerhalb von 14 Tagen ohne Abzug.',
  whatsappTemplate: DEFAULT_WHATSAPP_TEMPLATE,
  taxMode: 'standard19',
  openingHours: initialOpeningHours,
  modules: {
    fahrzeugpruefung: true,
    digitaleRechnungen: true,
    lagerverwaltung: false,
    betriebsberichte: false,
  },
};

const textInputClassName =
  'mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white';

type Notice = { tone: 'success' | 'error'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function settingsFromProfile(profile: unknown): Partial<WorkshopSettings> {
  if (!isRecord(profile)) return {};

  const settings: Partial<WorkshopSettings> = {};
  if (typeof profile.companyName === 'string') settings.companyName = profile.companyName;
  if (typeof profile.ownerName === 'string') settings.ownerName = profile.ownerName;
  if (typeof profile.street === 'string') settings.street = profile.street;
  if (typeof profile.zip === 'string') settings.postalCode = profile.zip;
  if (typeof profile.city === 'string') settings.city = profile.city;
  if (typeof profile.phone === 'string') settings.phone = profile.phone;
  if (typeof profile.email === 'string') settings.email = profile.email;
  if (typeof profile.website === 'string') settings.website = profile.website;
  if (typeof profile.taxNumber === 'string') settings.taxNumber = profile.taxNumber;
  if (typeof profile.vatId === 'string') settings.vatId = profile.vatId;
  if (typeof profile.bankName === 'string') settings.bankName = profile.bankName;
  if (typeof profile.iban === 'string') settings.iban = profile.iban;
  if (typeof profile.bic === 'string') settings.bic = profile.bic;
  if (typeof profile.isSmallBusiness === 'boolean') {
    settings.taxMode = profile.isSmallBusiness ? 'smallBusiness' : 'standard19';
  }
  const rate = parseHourlyRateCents(profile.hourlyRateCents);
  if (rate.ok) settings.hourlyRate = centsToEuros(rate.value);
  if (typeof profile.whatsappTemplate === 'string' && profile.whatsappTemplate.trim()) {
    settings.whatsappTemplate = profile.whatsappTemplate;
  }
  return settings;
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className={textInputClassName}
      />
    </label>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
      <h2 className="text-lg font-medium text-slate-900">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'company' | 'team' | 'modules'>('company');
  const [settings, setSettings] = useState<WorkshopSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let active = true;

    const loadSettings = async () => {
      try {
        const response = await fetch('/einstellungen/api', { cache: 'no-store' });
        const result: unknown = await response.json();
        if (!response.ok || !isRecord(result) || result.ok !== true) {
          throw new Error('Die Werkstattdaten konnten nicht geladen werden.');
        }

        if (active) {
          setSettings({ ...DEFAULT_SETTINGS, ...settingsFromProfile(result.profile) });
        }
      } catch {
        if (active) {
          setNotice({
            tone: 'error',
            message: 'Die Werkstattdaten konnten nicht geladen werden. Bitte versuche es erneut.',
          });
        }
      } finally {
        if (active) setIsLoaded(true);
      }
    };

    void loadSettings();
    return () => {
      active = false;
    };
  }, []);

  const updateSettings = <K extends keyof WorkshopSettings,>(key: K, value: WorkshopSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setNotice(null);
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(null);

    const hourlyRateCents = eurosToCentsOrNull(settings.hourlyRate);
    if (hourlyRateCents === null) {
      setNotice({ tone: 'error', message: 'Bitte gib einen gültigen Stundensatz ein (0 € oder mehr).' });
      return;
    }

    try {
      const response = await fetch('/einstellungen/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: settings.companyName,
          ownerName: settings.ownerName,
          street: settings.street,
          zip: settings.postalCode,
          city: settings.city,
          phone: settings.phone,
          email: settings.email,
          website: settings.website,
          taxNumber: settings.taxNumber,
          vatId: settings.vatId,
          bankName: settings.bankName,
          iban: settings.iban,
          bic: settings.bic,
          isSmallBusiness: settings.taxMode === 'smallBusiness',
          hourlyRateCents,
          // The unchanged default text is stored as "no own text", so the default stays the default.
          whatsappTemplate: settings.whatsappTemplate.trim() === DEFAULT_WHATSAPP_TEMPLATE ? '' : settings.whatsappTemplate,
        }),
      });
      const result: unknown = await response.json();
      if (!response.ok || !isRecord(result) || result.ok !== true) {
        const message =
          isRecord(result) && typeof result.error === 'string'
            ? result.error
            : 'Einstellungen konnten nicht gespeichert werden.';
        setNotice({ tone: 'error', message });
        return;
      }

      setNotice({
        tone: 'success',
        message: 'Werkstatt-Stammdaten, Stundensatz und Erinnerungsvorlage gespeichert. Rechnungsfußzeile, Öffnungszeiten und Module werden noch nicht dauerhaft gespeichert.',
      });
    } catch {
      setNotice({
        tone: 'error',
        message: 'Einstellungen konnten nicht gespeichert werden. Bitte versuche es erneut.',
      });
    }
  };

  const tabs = [
    { id: 'company' as const, label: 'Stammdaten & Rechtliches' },
    { id: 'team' as const, label: 'Konditionen & Texte' },
    { id: 'modules' as const, label: 'Öffnungszeiten & Module' },
  ];

  return (
    <div className="min-h-screen bg-slate-100 md:h-screen md:overflow-hidden">
      <div className="flex flex-col md:h-full md:flex-row">
        <Sidebar />

        <main className="wp-stagger min-w-0 flex-1 bg-slate-50 px-4 py-6 md:h-full md:overflow-y-auto lg:px-10 lg:py-8">
          <header className="border-b border-slate-200 pb-6">
            <p className="text-sm font-medium text-slate-500">Verwaltung</p>
            <h1 className="mt-2 text-3xl font-medium tracking-tight text-slate-900">Einstellungen</h1>
            <p className="mt-1 text-sm text-slate-500">
              Stammdaten, Werkstatt-Parameter und rechtliche Angaben verwalten
            </p>
            <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm font-medium">
              <Link href="/einstellungen/mitarbeiter" className="text-accent-700 hover:text-accent-600">
                Mitarbeiter verwalten (nur Inhaber)
              </Link>
              <Link href="/einstellungen/verfahrensdokumentation" className="text-accent-700 hover:text-accent-600">
                Verfahrensdokumentation
              </Link>
            </p>
          </header>

          <div
            className="mt-6 grid grid-cols-1 gap-1 rounded-2xl bg-slate-200/70 p-1 sm:grid-cols-3"
            role="tablist"
            aria-label="Einstellungsbereiche"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                id={`settings-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`settings-panel-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-xl px-4 py-3 text-sm font-medium transition ${
                  activeTab === tab.id
                    ? 'bg-white text-accent-700 shadow-sm'
                    : 'text-slate-600 hover:bg-white/60 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {notice && (
            <div
              role="status"
              className={`mt-5 flex items-start gap-3 rounded-2xl p-4 text-sm ${
                notice.tone === 'success'
                  ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
                  : 'bg-rose-50 text-rose-800 ring-1 ring-rose-200'
              }`}
            >
              {notice.tone === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              {notice.message}
            </div>
          )}

          {!isLoaded ? (
            <div className="mt-6 rounded-3xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
              Wird geladen …
            </div>
          ) : activeTab === 'company' ? (
            <form
              id="settings-panel-company"
              role="tabpanel"
              aria-labelledby="settings-tab-company"
              onSubmit={saveSettings}
              className="mt-6 space-y-5"
            >
              <SectionCard title="Unternehmensdaten">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="Firmenname"
                    value={settings.companyName}
                    onChange={(value) => updateSettings('companyName', value)}
                    required
                  />
                  <TextField
                    label="Inhaber / Meister"
                    value={settings.ownerName}
                    onChange={(value) => updateSettings('ownerName', value)}
                  />
                  <TextField
                    label="Straße und Hausnummer"
                    value={settings.street}
                    onChange={(value) => updateSettings('street', value)}
                  />
                  <div className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] gap-3">
                    <TextField
                      label="PLZ"
                      value={settings.postalCode}
                      onChange={(value) => updateSettings('postalCode', value)}
                    />
                    <TextField
                      label="Ort"
                      value={settings.city}
                      onChange={(value) => updateSettings('city', value)}
                    />
                  </div>
                  <TextField
                    label="Telefon"
                    type="tel"
                    value={settings.phone}
                    onChange={(value) => updateSettings('phone', value)}
                  />
                  <TextField
                    label="E-Mail"
                    type="email"
                    value={settings.email}
                    onChange={(value) => updateSettings('email', value)}
                  />
                  <TextField
                    label="Website"
                    type="url"
                    value={settings.website}
                    onChange={(value) => updateSettings('website', value)}
                    placeholder="https://"
                  />
                </div>
              </SectionCard>

              <SectionCard title="Steuern & Rechtliches">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="Steuernummer"
                    value={settings.taxNumber}
                    onChange={(value) => updateSettings('taxNumber', value)}
                  />
                  <TextField
                    label="USt-IdNr."
                    value={settings.vatId}
                    onChange={(value) => updateSettings('vatId', value)}
                    placeholder="DE123456789"
                  />
                </div>
              </SectionCard>

              <SectionCard title="Bankverbindung">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="Bankname"
                    value={settings.bankName}
                    onChange={(value) => updateSettings('bankName', value)}
                  />
                  <TextField
                    label="IBAN"
                    value={settings.iban}
                    onChange={(value) => updateSettings('iban', value)}
                  />
                  <TextField
                    label="BIC"
                    value={settings.bic}
                    onChange={(value) => updateSettings('bic', value)}
                  />
                </div>
              </SectionCard>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="w-full rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 sm:w-auto"
                >
                  Änderungen speichern
                </button>
              </div>
            </form>
          ) : activeTab === 'team' ? (
            <form
              id="settings-panel-team"
              role="tabpanel"
              aria-labelledby="settings-tab-team"
              onSubmit={saveSettings}
              className="mt-6 space-y-5"
            >
              <SectionCard title="Stundensatz">
                <div className="max-w-sm">
                  <label className="block text-sm font-medium text-slate-700">
                    Standard-Verrechnungssatz für Arbeitsstunden
                    <div className="mt-2 flex items-center gap-3">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={settings.hourlyRate}
                        onChange={(event) => updateSettings('hourlyRate', Number(event.target.value))}
                        className={textInputClassName}
                        required
                      />
                      <span className="shrink-0 text-sm text-slate-500">€ / Std.</span>
                    </div>
                  </label>
                </div>
              </SectionCard>

              <SectionCard title="Texte & Vorlagen">
                <div className="space-y-4">
                  <label className="block text-sm font-medium text-slate-700">
                    Standard-Rechnungsfußzeile
                    <textarea
                      value={settings.invoiceFooter}
                      onChange={(event) => updateSettings('invoiceFooter', event.target.value)}
                      rows={3}
                      className={`${textInputClassName} resize-y`}
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Vorlagentext für WhatsApp-TÜV-Erinnerungen
                    <textarea
                      value={settings.whatsappTemplate}
                      onChange={(event) => updateSettings('whatsappTemplate', event.target.value)}
                      rows={5}
                      className={`${textInputClassName} resize-y`}
                    />
                    <span className="mt-2 block text-xs font-normal text-slate-500">
                      Platzhalter: {'{Kundenname}'}, {'{Fahrzeug}'}, {'{Kennzeichen}'}, {'{TÜV-Datum}'}
                    </span>
                  </label>
                </div>
              </SectionCard>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="w-full rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 sm:w-auto"
                >
                  Einstellungen speichern
                </button>
              </div>
            </form>
          ) : (
            <form
              id="settings-panel-modules"
              role="tabpanel"
              aria-labelledby="settings-tab-modules"
              onSubmit={saveSettings}
              className="mt-6 space-y-5"
            >
              <SectionCard title="Steuerliche Grundeinstellung">
                <label className="block max-w-xl text-sm font-medium text-slate-700">
                  Besteuerung für neue Rechnungsentwürfe
                  <select
                    value={settings.taxMode}
                    onChange={(event) => updateSettings('taxMode', event.target.value as TaxMode)}
                    className={textInputClassName}
                  >
                    <option value="standard19">19 % Umsatzsteuer</option>
                    <option value="reduced7">7 % Umsatzsteuer</option>
                    <option value="smallBusiness">§ 19 UStG – Kleinunternehmerregelung</option>
                  </select>
                </label>
                <p className="mt-3 text-xs text-slate-500">
                  Bitte die steuerliche Behandlung mit der steuerlichen Beratung abstimmen. Die Auswahl ersetzt keine Prüfung einzelner Rechnungspositionen.
                </p>
              </SectionCard>

              <SectionCard title="Öffnungszeiten">
                <div className="space-y-3">
                  {weekdays.map((day) => {
                    const hours = settings.openingHours[day];
                    return (
                      <div key={day} className="grid gap-3 rounded-2xl bg-slate-50 p-3 sm:grid-cols-[150px_1fr_1fr_130px] sm:items-center">
                        <span className="text-sm font-medium text-slate-800">{day}</span>
                        <label className="text-xs font-medium text-slate-500">
                          Von
                          <input
                            type="time"
                            value={hours.open}
                            disabled={hours.closed}
                            onChange={(event) => updateSettings('openingHours', {
                              ...settings.openingHours,
                              [day]: { ...hours, open: event.target.value },
                            })}
                            className={`${textInputClassName} mt-1`}
                          />
                        </label>
                        <label className="text-xs font-medium text-slate-500">
                          Bis
                          <input
                            type="time"
                            value={hours.close}
                            disabled={hours.closed}
                            onChange={(event) => updateSettings('openingHours', {
                              ...settings.openingHours,
                              [day]: { ...hours, close: event.target.value },
                            })}
                            className={`${textInputClassName} mt-1`}
                          />
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={hours.closed}
                            onChange={(event) => updateSettings('openingHours', {
                              ...settings.openingHours,
                              [day]: { ...hours, closed: event.target.checked },
                            })}
                            className="h-4 w-4 rounded border-slate-300 text-accent-700 focus:ring-accent-600/25"
                          />
                          Geschlossen
                        </label>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>

              <SectionCard title="Zusatzmodule">
                <p className="mb-4 text-sm text-slate-500">Module ein- oder ausschalten. Der lokale Prototyp speichert nur die Auswahl, kein Abonnement.</p>
                <div className="space-y-3">
                  {([
                    ['fahrzeugpruefung', 'Digitale Fahrzeugprüfung', 'Fotodokumentation und digitale Prüfbefunde'],
                    ['digitaleRechnungen', 'Rechnungsverwaltung', 'Rechnungsentwürfe und Zahlungsübersicht'],
                    ['lagerverwaltung', 'Lagerverwaltung', 'Bestände und Nachbestellhinweise für Ersatzteile'],
                    ['betriebsberichte', 'Betriebsberichte', 'Umsatz- und Auftragsauswertungen'],
                  ] as const).map(([key, label, description]) => (
                    <label key={key} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 p-4">
                      <span>
                        <span className="block text-sm font-medium text-slate-800">{label}</span>
                        <span className="mt-1 block text-xs text-slate-500">{description}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.modules[key]}
                        onChange={(event) => updateSettings('modules', {
                          ...settings.modules,
                          [key]: event.target.checked,
                        })}
                        className="h-5 w-5 shrink-0 rounded border-slate-300 text-accent-700 focus:ring-accent-600/25"
                      />
                    </label>
                  ))}
                </div>
              </SectionCard>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="w-full rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 sm:w-auto"
                >
                  Einstellungen speichern
                </button>
              </div>
            </form>
          )}
        </main>
      </div>
    </div>
  );
}
