'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Clock3, Plus, Search, Settings, Trash2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppointmentModal from '../../components/AppointmentModal';
import Sidebar from '../../components/Sidebar';
import Plate from '../../components/Plate';
import StatusBadge from '../../components/StatusBadge';
import CalendarSettingsModal from '../../components/calendar/CalendarSettingsModal';
import DayView, { type DayGrouping } from '../../components/calendar/DayView';
import WeekView from '../../components/calendar/WeekView';
import { CalendarToolbar, ViewSwitch, type CalendarView } from '../../components/calendar/CalendarControls';
import {
  getTodayDateString,
  type Appointment,
  type AppointmentForm,
  type AppointmentStatus,
} from '../../lib/appointments';
import { formatLongGermanDateWithWeekday, formatWeekRange, getIsoWeekDates, getIsoWeekNumber, parseTimeToMinutes } from '../../lib/calendar';
import { CALENDAR_GRID_END, CALENDAR_GRID_START } from '../../lib/calendar-config';
import { findAppointmentConflict, type ResourceColumn } from '../../lib/calendar-drag';
import { addDaysToDateString } from '../../lib/date';
import { findMechanicAbsence, describeAbsence } from '../../lib/absences';
import { useAppointments, type AppointmentMovePatch } from '../../lib/hooks/useAppointments';
import { useCalendarData } from '../../lib/hooks/useCalendarData';
import { formatUtilizationHours, getUtilization, sumUtilization } from '../../lib/utilization';
import { useCustomers } from '../../lib/hooks/useCustomers';
import { workstations } from '../../lib/workshop';

const DAY_GROUPINGS: ReadonlyArray<{ id: DayGrouping; label: string }> = [
  { id: 'none', label: 'Ganzer Tag' },
  { id: 'bay', label: 'Arbeitsplätze' },
  { id: 'mechanic', label: 'Mechaniker' },
];

type StatusFilter = 'Alle' | AppointmentStatus;

const statusFilters: StatusFilter[] = ['Alle', 'Bestätigt', 'Ausstehend', 'Abgeschlossen'];

function AppointmentPrefillWatcher({
  onPrefill,
}: {
  onPrefill: (customerId: string, vehicleId?: string) => void;
}) {
  const searchParams = useSearchParams();
  const customerId = searchParams.get('customerId');
  const vehicleId = searchParams.get('vehicleId') ?? undefined;

  useEffect(() => {
    if (customerId) onPrefill(customerId, vehicleId);
  }, [customerId, onPrefill, vehicleId]);

  return null;
}

/** `/termine?einstellungen=1` (link from the onboarding checklist) opens the calendar settings once. */
function SettingsLinkWatcher({ enabled, onOpen }: { enabled: boolean; onOpen: () => void }) {
  const searchParams = useSearchParams();
  const requested = searchParams.get('einstellungen') === '1';
  const opened = useRef(false);

  useEffect(() => {
    if (requested && enabled && !opened.current) {
      opened.current = true;
      onOpen();
    }
  }, [enabled, onOpen, requested]);

  return null;
}

function formatGroupDate(date: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00`));
}

export default function AppointmentsPage() {
  const {
    appointments,
    mechanics,
    error: appointmentError,
    addAppointment,
    updateAppointment,
    deleteAppointment,
    moveAppointment,
  } = useAppointments();
  const {
    customers,
    vehicles,
    isLoaded: customersLoaded,
    updateVehicle,
  } = useCustomers();
  const {
    settings: calendarSettings,
    absences,
    canEdit: canEditCalendar,
    saveSettings: saveCalendarSettings,
    addAbsence,
    removeAbsence,
  } = useCalendarData();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const openCalendarSettings = useCallback(() => setIsSettingsOpen(true), []);
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('Alle');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [appointmentDefaults, setAppointmentDefaults] = useState<{
    customerId?: string;
    vehicleId?: string;
    date?: string;
    time?: string;
    bay?: string;
    mechanicId?: string;
  } | null>(null);
  const [view, setView] = useState<CalendarView>('woche');
  const [grouping, setGrouping] = useState<DayGrouping>('bay');
  const [toast, setToast] = useState<string | null>(null);
  const [anchorDate, setAnchorDate] = useState(() => getTodayDateString());
  // `now` stays null on the server render so the red "now" line cannot cause a hydration mismatch.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const isCalendar = view !== 'liste';
  const gridScrollRef = useRef<HTMLDivElement>(null);

  // Open the grid at the start of the working day (minus half an hour) instead of at the top of the grid.
  useEffect(() => {
    const element = gridScrollRef.current;
    if (!isCalendar || !element) return undefined;
    const gridStart = parseTimeToMinutes(CALENDAR_GRID_START);
    const gridEnd = parseTimeToMinutes(CALENDAR_GRID_END);
    const target = Math.max(gridStart, parseTimeToMinutes(calendarSettings.workStart) - 30);
    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = ((target - gridStart) / (gridEnd - gridStart)) * element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [calendarSettings.workStart, grouping, isCalendar, view]);

  const handlePrefill = useCallback((customerId: string, vehicleId?: string) => {
    setEditingAppointment(null);
    setAppointmentDefaults({ customerId, vehicleId: vehicleId ?? undefined });
    setIsModalOpen(true);
    router.replace('/termine', { scroll: false });
  }, [router]);

  const todayDate = getTodayDateString();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = getTodayDateString(tomorrow);

  const filteredAppointments = useMemo(() => {
    const searchTerm = search.trim().toLocaleLowerCase('de-DE');

    return appointments
      .filter((appointment) => {
        const matchesSearch =
          searchTerm.length === 0 ||
          [appointment.customer, appointment.plate, appointment.vehicle, appointment.reason].some((value) =>
            value.toLocaleLowerCase('de-DE').includes(searchTerm),
          );
        const matchesStatus = statusFilter === 'Alle' || appointment.status === statusFilter;
        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => {
        const aIsPast = a.date < todayDate;
        const bIsPast = b.date < todayDate;
        if (aIsPast !== bIsPast) return aIsPast ? 1 : -1;
        return a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
      });
  }, [appointments, search, statusFilter, todayDate]);

  const appointmentGroups = useMemo(() => {
    const groups = new Map<string, Appointment[]>();
    filteredAppointments.forEach((appointment) => {
      const group = groups.get(appointment.date);
      if (group) {
        group.push(appointment);
      } else {
        groups.set(appointment.date, [appointment]);
      }
    });
    return Array.from(groups, ([date, groupAppointments]) => ({ date, appointments: groupAppointments }));
  }, [filteredAppointments]);

  const openNewAppointmentModal = () => {
    setEditingAppointment(null);
    setAppointmentDefaults(null);
    setIsModalOpen(true);
  };

  const openAppointmentModalAtSlot = (date: string, time: string, target?: ResourceColumn['target']) => {
    setEditingAppointment(null);
    setAppointmentDefaults({
      date,
      time,
      bay: target && 'bay' in target ? target.bay : undefined,
      mechanicId: target && 'mechanicId' in target ? target.mechanicId : undefined,
    });
    setIsModalOpen(true);
  };

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleCalendarChange = async (appointment: Appointment, change: AppointmentMovePatch) => {
    // Refuse an impossible drop right away; the database would answer 409 for the same case.
    const conflict = findAppointmentConflict(appointments, appointment.id, {
      date: change.date ?? appointment.date,
      time: change.time ?? appointment.time,
      durationMinutes: change.durationMinutes ?? appointment.durationMinutes,
      bay: change.bay ?? appointment.bay,
      mechanicId: 'mechanicId' in change ? change.mechanicId : appointment.mechanicId,
    });
    if (conflict) {
      setToast(
        `Verschieben nicht möglich: Der Termin überschneidet sich mit ${conflict.customer} (${conflict.time}, ${conflict.bay}).`,
      );
      return;
    }

    // A mechanic who is away (Urlaub, Krank, Schule) cannot be booked on that day.
    const targetMechanicId = 'mechanicId' in change ? change.mechanicId : appointment.mechanicId;
    const targetDate = change.date ?? appointment.date;
    const absence = findMechanicAbsence(absences, targetMechanicId, targetDate);
    if (absence) {
      const name = mechanics.find((mechanic) => mechanic.id === targetMechanicId)?.name ?? 'Der Mitarbeiter';
      setToast(`Verschieben nicht möglich: ${name} ist an diesem Tag abwesend (${describeAbsence(absence)}).`);
      return;
    }

    const message = await moveAppointment(appointment, change);
    if (message) setToast(`Der Termin wurde nicht verschoben. ${message}`);
  };

  const shiftCalendar = (direction: -1 | 1) => {
    setAnchorDate((current) => addDaysToDateString(current, direction * (view === 'tag' ? 1 : 7)));
  };

  const weekDays = getIsoWeekDates(anchorDate);
  // Utilization of the shown week or day: every appointment counts, whatever the search filter says.
  const utilizationSummary = useMemo(() => {
    const days = view === 'tag' ? [anchorDate] : getIsoWeekDates(anchorDate);
    const workers: (string | undefined)[] = mechanics.length > 0 ? mechanics.map((mechanic) => mechanic.id) : [undefined];
    return sumUtilization(
      days.map((date) => getUtilization({ date, appointments, workers, settings: calendarSettings, absences })),
    );
  }, [absences, anchorDate, appointments, calendarSettings, mechanics, view]);
  const calendarLabel =
    view === 'tag' ? formatLongGermanDateWithWeekday(anchorDate) : formatWeekRange(weekDays[0], weekDays[6]);

  const openEditAppointmentModal = (appointment: Appointment) => {
    setEditingAppointment(appointment);
    setAppointmentDefaults(null);
    setIsModalOpen(true);
  };

  const handleDeleteAppointment = (appointment: Appointment) => {
    if (!window.confirm(`Möchtest du den Termin für ${appointment.customer} wirklich löschen?`)) return;
    deleteAppointment(appointment.id);
  };

  const handleSaveAppointment = (form: AppointmentForm) => {
    if (editingAppointment) {
      updateAppointment(editingAppointment.id, form);
    } else {
      addAppointment(form);
    }
    setEditingAppointment(null);
    setAppointmentDefaults(null);
    setIsModalOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-100 md:h-screen md:overflow-hidden">
      <div className="flex flex-col md:h-full md:flex-row">
        <Suspense fallback={null}>
          <AppointmentPrefillWatcher onPrefill={handlePrefill} />
          <SettingsLinkWatcher enabled={canEditCalendar} onOpen={openCalendarSettings} />
        </Suspense>
        <Sidebar />

        <main className={`min-w-0 flex-1 rounded-3xl bg-slate-50 p-4 shadow-soft ring-1 ring-slate-200/80 md:h-full lg:p-6 ${isCalendar ? 'md:flex md:flex-col md:overflow-hidden' : 'md:overflow-y-auto'}`}>
          <header className={`flex flex-col gap-3 border-b border-slate-200 sm:flex-row sm:items-center sm:justify-between ${isCalendar ? 'pb-3' : 'pb-6'}`}>
            <div>
              {!isCalendar && <p className="text-sm font-medium text-slate-500">Terminverwaltung</p>}
              <h1 className={`font-medium text-slate-900 ${isCalendar ? 'text-2xl' : 'mt-2 text-3xl'}`}>Alle Termine</h1>
              {!isCalendar && <p className="mt-1 text-sm text-slate-500">Termine suchen, filtern und verwalten</p>}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <ViewSwitch view={view} onChange={setView} />
              {canEditCalendar && (
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Settings className="h-4 w-4" />
                  Einstellungen
                </button>
              )}
              <button
                type="button"
                onClick={openNewAppointmentModal}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                Neuer Termin
              </button>
            </div>
          </header>

          <section className={isCalendar ? 'hidden' : 'mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200'}>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
              <label className="relative block text-sm font-medium text-slate-700">
                Suche
                <Search className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Kunde, Kennzeichen, Fahrzeug oder Grund"
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Status
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                >
                  {statusFilters.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {view !== 'liste' && (
            <section className="mt-3 flex min-h-0 flex-col gap-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200 md:flex-1">
              {appointmentError && (
                <p role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700 ring-1 ring-rose-200">
                  {appointmentError}
                </p>
              )}
              <CalendarToolbar
                weekNumber={getIsoWeekNumber(anchorDate)}
                label={calendarLabel}
                anchorDate={anchorDate}
                previousLabel={view === 'tag' ? 'Vorheriger Tag' : 'Vorherige Woche'}
                nextLabel={view === 'tag' ? 'Nächster Tag' : 'Nächste Woche'}
                onPrevious={() => shiftCalendar(-1)}
                onNext={() => shiftCalendar(1)}
                onToday={() => setAnchorDate(todayDate)}
                onDateChange={setAnchorDate}
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="min-w-[14rem] flex-1 text-xs text-slate-600">
                {view === 'tag' ? 'Auslastung des Tages' : 'Auslastung der Woche'}:{' '}
                {utilizationSummary.percent === null ? (
                  <span className="font-medium text-slate-900">keine verfügbare Arbeitszeit</span>
                ) : (
                  <>
                    <span className="font-medium text-slate-900">{utilizationSummary.percent} %</span>
                    <span className="text-slate-500"> ({formatUtilizationHours(utilizationSummary)}, abzüglich Pause, Urlaub und Feiertage)</span>
                  </>
                )}
              </p>
              {view === 'tag' && (
                <div className="inline-flex rounded-2xl bg-slate-200/70 p-1" role="group" aria-label="Spalten">
                  {DAY_GROUPINGS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={grouping === option.id}
                      onClick={() => setGrouping(option.id)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${grouping === option.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
                <label className="relative block min-w-[12rem] flex-1 sm:max-w-xs">
                  <span className="sr-only">Suche</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Kunde, Kennzeichen, Fahrzeug …"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-9 pr-3 text-xs text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                  />
                </label>
                <label className="block">
                  <span className="sr-only">Status</span>
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                  >
                    {statusFilters.map((status) => (
                      <option key={status} value={status}>
                        {status === 'Alle' ? 'Status: alle' : status}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div ref={gridScrollRef} className="h-[70vh] min-h-0 overflow-y-auto rounded-2xl ring-1 ring-slate-200 md:h-auto md:flex-1">
                {view === 'woche' ? (
                  <WeekView
                    anchorDate={anchorDate}
                    today={todayDate}
                    now={now}
                    appointments={filteredAppointments}
                    allAppointments={appointments}
                    settings={calendarSettings}
                    absences={absences}
                    mechanics={mechanics}
                    onSlotClick={openAppointmentModalAtSlot}
                    onAppointmentClick={openEditAppointmentModal}
                    onAppointmentChange={handleCalendarChange}
                  />
                ) : (
                  <DayView
                    date={anchorDate}
                    today={todayDate}
                    now={now}
                    appointments={filteredAppointments}
                    allAppointments={appointments}
                    settings={calendarSettings}
                    absences={absences}
                    grouping={grouping}
                    knownBays={workstations}
                    mechanics={mechanics}
                    onSlotClick={openAppointmentModalAtSlot}
                    onAppointmentClick={openEditAppointmentModal}
                    onAppointmentChange={handleCalendarChange}
                  />
                )}
              </div>
            </section>
          )}

          <section className={view === 'liste' ? 'mt-6 space-y-5' : 'hidden'}>
            {appointmentError && (
              <p role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700 ring-1 ring-rose-200">
                {appointmentError}
              </p>
            )}
            {appointmentGroups.length === 0 ? (
              <div className="rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
                <h2 className="text-lg font-medium text-slate-900">
                  {appointments.length === 0 ? 'Noch keine Termine vorhanden' : 'Keine Termine gefunden'}
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  {appointments.length === 0
                    ? 'Lege einen neuen Termin an, damit er hier angezeigt wird.'
                    : 'Passe deine Suche oder den Statusfilter an.'}
                </p>
              </div>
            ) : (
              appointmentGroups.map(({ date, appointments: groupAppointments }) => (
                <div key={date} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                  <div className="mb-5 flex flex-wrap items-center gap-3">
                    <h2 className="text-xl font-medium text-slate-900">{formatGroupDate(date)}</h2>
                    {date === todayDate && (
                      <span className="rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-800">Heute</span>
                    )}
                    {date === tomorrowDate && (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">Morgen</span>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left">
                      <thead>
                        <tr className="border-b border-slate-200 text-sm text-slate-500">
                          <th className="px-3 py-3 font-medium">Uhrzeit</th>
                          <th className="px-3 py-3 font-medium">Kunde</th>
                          <th className="px-3 py-3 font-medium">Fahrzeug</th>
                          <th className="px-3 py-3 font-medium">Grund</th>
                          <th className="px-3 py-3 font-medium">Arbeitsplatz / Mechaniker</th>
                          <th className="px-3 py-3 font-medium">Status</th>
                          <th className="px-3 py-3 text-right font-medium">Aktionen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupAppointments.map((appointment) => (
                          <tr key={appointment.id} className="border-b border-slate-100 text-sm text-slate-700 last:border-0">
                            <td className="px-3 py-4">
                              <div className="flex items-center gap-2 font-medium text-slate-900">
                                <Clock3 className="h-4 w-4 text-slate-400" />
                                {appointment.time}
                              </div>
                              <p className="mt-1 pl-6 text-xs text-slate-500">{appointment.durationMinutes} Min.</p>
                            </td>
                            <td className="px-3 py-4 font-medium text-slate-900">{appointment.customer}</td>
                            <td className="px-3 py-4">
                              <div>
                                <p className="font-medium text-slate-900">{appointment.vehicle}</p>
                                <Plate value={appointment.plate} className="mt-1" />
                              </div>
                            </td>
                            <td className="px-3 py-4 text-slate-600">{appointment.reason}</td>
                            <td className="px-3 py-4">
                              <p className="font-medium text-slate-700">{appointment.bay}</p>
                              <p className="text-xs text-slate-500">
                                {mechanics.find((mechanic) => mechanic.id === appointment.mechanicId)?.name ?? 'Nicht zugewiesen'}
                              </p>
                            </td>
                            <td className="px-3 py-4">
                              <StatusBadge status={appointment.status} tone={appointment.tone} />
                            </td>
                            <td className="px-3 py-4">
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEditAppointmentModal(appointment)}
                                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  <ArrowRight className="h-3.5 w-3.5" />
                                  Bearbeiten
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAppointment(appointment)}
                                  className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Löschen
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </section>
        </main>
      </div>

      {isModalOpen && (
        <AppointmentModal
          appointment={editingAppointment}
          customers={customers}
          vehicles={vehicles}
          mechanics={mechanics}
          customersLoaded={customersLoaded}
          initialCustomerId={appointmentDefaults?.customerId}
          initialVehicleId={appointmentDefaults?.vehicleId}
          initialDate={appointmentDefaults?.date}
          initialTime={appointmentDefaults?.time}
          initialBay={appointmentDefaults?.bay}
          initialMechanicId={appointmentDefaults?.mechanicId}
          onUpdateVehicle={updateVehicle}
          onClose={() => {
            setIsModalOpen(false);
            setEditingAppointment(null);
            setAppointmentDefaults(null);
          }}
          onSave={handleSaveAppointment}
        />
      )}

      {isSettingsOpen && (
        <CalendarSettingsModal
          settings={calendarSettings}
          absences={absences}
          mechanics={mechanics}
          today={todayDate}
          onSaveSettings={saveCalendarSettings}
          onAddAbsence={addAbsence}
          onRemoveAbsence={removeAbsence}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {toast && (
        <div
          role="alert"
          className="fixed bottom-6 left-1/2 z-50 flex max-w-[min(90vw,32rem)] -translate-x-1/2 items-start gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-2xl"
        >
          <p>{toast}</p>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Meldung schließen"
            className="shrink-0 rounded-lg px-2 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
