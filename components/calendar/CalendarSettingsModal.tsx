'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Trash2, X } from 'lucide-react';
import ConfirmDialog from '../ConfirmDialog';
import { ABSENCE_TYPES, AbsenceError, describeAbsence, parseAbsenceInput, type Absence, type AbsenceInput, type AbsenceType } from '../../lib/absences';
import type { AppointmentMechanic } from '../../lib/appointments';
import { BUNDESLAND_NAMES, CalendarSettingsError, parseCalendarSettings, type CalendarSettings } from '../../lib/calendar-settings';
import { BUNDESLAENDER } from '../../lib/holidays';

type CalendarSettingsModalProps = {
  settings: CalendarSettings;
  absences: readonly Absence[];
  mechanics: readonly AppointmentMechanic[];
  today: string;
  /** Each of these returns null on success or a German error message. */
  onSaveSettings: (settings: CalendarSettings) => Promise<string | null>;
  onAddAbsence: (input: AbsenceInput) => Promise<string | null>;
  onRemoveAbsence: (id: string) => Promise<string | null>;
  onClose: () => void;
};

const FIELD_CLASS =
  'mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white';

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('de-DE').format(new Date(`${date}T00:00:00`));
}

function formatRange(absence: Absence): string {
  return absence.startDate === absence.endDate
    ? formatDate(absence.startDate)
    : `${formatDate(absence.startDate)} – ${formatDate(absence.endDate)}`;
}

export default function CalendarSettingsModal({
  settings,
  absences,
  mechanics,
  today,
  onSaveSettings,
  onAddAbsence,
  onRemoveAbsence,
  onClose,
}: CalendarSettingsModalProps) {
  const [form, setForm] = useState<CalendarSettings>(settings);
  const [settingsMessage, setSettingsMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const [mechanicId, setMechanicId] = useState(mechanics[0]?.id ?? '');
  const [type, setType] = useState<AbsenceType>('Urlaub');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [note, setNote] = useState('');
  const [absenceError, setAbsenceError] = useState<string | null>(null);
  const [isSavingAbsence, setIsSavingAbsence] = useState(false);
  const [absenceToDelete, setAbsenceToDelete] = useState<Absence | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !absenceToDelete) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [absenceToDelete, onClose]);

  const mechanicName = (id: string) => mechanics.find((mechanic) => mechanic.id === id)?.name ?? 'Mitarbeiter';

  const handleSaveSettings = async (event: FormEvent) => {
    event.preventDefault();
    setSettingsMessage(null);
    let parsed: CalendarSettings;
    try {
      parsed = parseCalendarSettings(form);
    } catch (error) {
      if (error instanceof CalendarSettingsError) {
        setSettingsMessage({ tone: 'error', text: error.message });
        return;
      }
      throw error;
    }

    setIsSavingSettings(true);
    const message = await onSaveSettings(parsed);
    setIsSavingSettings(false);
    setSettingsMessage(message ? { tone: 'error', text: message } : { tone: 'success', text: 'Die Einstellungen wurden gespeichert.' });
  };

  const handleAddAbsence = async (event: FormEvent) => {
    event.preventDefault();
    setAbsenceError(null);
    let input: AbsenceInput;
    try {
      input = parseAbsenceInput({ mechanicId, type, startDate, endDate, note });
    } catch (error) {
      if (error instanceof AbsenceError) {
        setAbsenceError(error.message);
        return;
      }
      throw error;
    }

    setIsSavingAbsence(true);
    const message = await onAddAbsence(input);
    setIsSavingAbsence(false);
    if (message) {
      setAbsenceError(message);
    } else {
      setNote('');
    }
  };

  const handleDeleteAbsence = async () => {
    if (!absenceToDelete) return;
    const message = await onRemoveAbsence(absenceToDelete.id);
    setAbsenceToDelete(null);
    if (message) setAbsenceError(message);
  };

  const setTime = (key: 'workStart' | 'workEnd' | 'lunchStart' | 'lunchEnd', value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const sortedAbsences = [...absences].sort(
    (a, b) => Number(a.endDate < today) - Number(b.endDate < today) || a.startDate.localeCompare(b.startDate),
  );

  return (
    <div className="wp-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center overflow-y-auto bg-slate-950/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-settings-title"
        className="wp-sheet mt-auto sm:my-auto w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="calendar-settings-title" className="text-2xl font-medium text-slate-900">
            Kalender-Einstellungen
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSaveSettings} className="mt-6 space-y-4">
          <h3 className="text-sm font-medium text-slate-500">Bundesland und Arbeitszeiten</h3>
          <label className="block text-sm font-medium text-slate-700">
            Bundesland (bestimmt die Feiertage)
            <select
              value={form.bundesland}
              onChange={(event) => setForm((current) => ({ ...current, bundesland: event.target.value as CalendarSettings['bundesland'] }))}
              className={FIELD_CLASS}
            >
              {BUNDESLAENDER.map((code) => (
                <option key={code} value={code}>
                  {BUNDESLAND_NAMES[code]}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-4">
            {(
              [
                ['workStart', 'Arbeitsbeginn'],
                ['workEnd', 'Arbeitsende'],
                ['lunchStart', 'Pause von'],
                ['lunchEnd', 'Pause bis'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block text-sm font-medium text-slate-700">
                {label}
                <input type="time" value={form[key]} onChange={(event) => setTime(key, event.target.value)} className={FIELD_CLASS} required />
              </label>
            ))}
          </div>

          {settingsMessage && (
            <p
              role={settingsMessage.tone === 'error' ? 'alert' : 'status'}
              className={`rounded-xl p-3 text-sm ${settingsMessage.tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}
            >
              {settingsMessage.text}
            </p>
          )}
          <button
            type="submit"
            disabled={isSavingSettings}
            className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            {isSavingSettings ? 'Speichern…' : 'Einstellungen speichern'}
          </button>
        </form>

        <div className="mt-8 border-t border-slate-200 pt-6">
          <h3 className="text-sm font-medium text-slate-500">Abwesenheiten</h3>

          {sortedAbsences.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Keine Abwesenheiten eingetragen.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 rounded-2xl ring-1 ring-slate-200">
              {sortedAbsences.map((absence) => (
                <li
                  key={absence.id}
                  className={`flex items-center justify-between gap-3 px-4 py-3 text-sm ${absence.endDate < today ? 'text-slate-400' : 'text-slate-800'}`}
                >
                  <div>
                    <p className="font-medium">{mechanicName(absence.mechanicId)}</p>
                    <p>
                      {formatRange(absence)} · {describeAbsence(absence)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAbsenceToDelete(absence)}
                    aria-label={`Abwesenheit von ${mechanicName(absence.mechanicId)} löschen`}
                    className="rounded-xl border border-rose-200 p-2 text-rose-700 hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {mechanics.length === 0 ? (
            <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              Es gibt noch keine Mitarbeiter mit der Rolle Mechaniker. Sobald welche eingeladen sind, kannst du hier Urlaub eintragen.
            </p>
          ) : (
            <form onSubmit={handleAddAbsence} className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">
                Mitarbeiter
                <select value={mechanicId} onChange={(event) => setMechanicId(event.target.value)} className={FIELD_CLASS}>
                  {mechanics.map((mechanic) => (
                    <option key={mechanic.id} value={mechanic.id}>
                      {mechanic.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Art
                <select value={type} onChange={(event) => setType(event.target.value as AbsenceType)} className={FIELD_CLASS}>
                  {ABSENCE_TYPES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Von
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                    if (endDate < event.target.value) setEndDate(event.target.value);
                  }}
                  className={FIELD_CLASS}
                  required
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Bis (einschließlich)
                <input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} className={FIELD_CLASS} required />
              </label>
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                Notiz (optional)
                <input type="text" value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} className={FIELD_CLASS} />
              </label>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={isSavingAbsence}
                  className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  {isSavingAbsence ? 'Speichern…' : 'Abwesenheit hinzufügen'}
                </button>
              </div>
            </form>
          )}

          {absenceError && (
            <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
              {absenceError}
            </p>
          )}
        </div>
      </div>

      {absenceToDelete && (
        <ConfirmDialog
          title="Abwesenheit löschen?"
          message={`${mechanicName(absenceToDelete.mechanicId)}, ${formatRange(absenceToDelete)} (${absenceToDelete.type}) wird entfernt.`}
          onCancel={() => setAbsenceToDelete(null)}
          onConfirm={handleDeleteAbsence}
        />
      )}
    </div>
  );
}
