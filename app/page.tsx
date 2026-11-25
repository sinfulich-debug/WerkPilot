'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ChevronRight,
  Clock3,
  MessageSquareText,
  Plus,
  Trash2,
} from 'lucide-react';
import AppointmentModal from '../components/AppointmentModal';
import CountUp from '../components/CountUp';
import OnboardingChecklist from '../components/OnboardingChecklist';
import Plate from '../components/Plate';
import Sidebar from '../components/Sidebar';
import StatusBadge from '../components/StatusBadge';
import {
  getTodayDateString,
  type Appointment,
  type AppointmentForm,
} from '../lib/appointments';
import { useAppointments } from '../lib/hooks/useAppointments';
import { getTuvStatus } from '../lib/customers';
import { useCustomers } from '../lib/hooks/useCustomers';
import { useWorkshopName } from '../lib/hooks/useWorkshopName';

export default function HomePage() {
  const {
    appointments,
    mechanics,
    error: appointmentError,
    addAppointment,
    updateAppointment,
    deleteAppointment,
  } = useAppointments();
  const {
    customers,
    vehicles: customerVehicles,
    isLoaded: customersLoaded,
    updateVehicle: updateCustomerVehicle,
  } = useCustomers();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const workshopName = useWorkshopName();

  const dateLabel = new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
  const todayDate = getTodayDateString();

  const todayAppointments = useMemo(
    () => appointments.filter((appointment) => appointment.date === todayDate).sort((a, b) => a.time.localeCompare(b.time)),
    [appointments, todayDate],
  );

  const tuvCounts = useMemo(
    () =>
      customerVehicles.reduce(
        (counts, vehicle) => {
          const { status } = getTuvStatus(vehicle.tuvDueDate);
          if (status === 'overdue') counts.overdue += 1;
          if (status === 'soon') counts.soon += 1;
          return counts;
        },
        { overdue: 0, soon: 0 },
      ),
    [customerVehicles],
  );

  const kpis = useMemo(() => {
    const todayCount = todayAppointments.length;
    const openTuv = tuvCounts.overdue + tuvCounts.soon;
    const confirmedCount = todayAppointments.filter((item) => item.status === 'Bestätigt').length;
    const confirmedRate = todayCount > 0 ? Math.round((confirmedCount / todayCount) * 100) : 0;

    return [
      {
        label: 'Termine heute',
        value: todayCount,
        unit: todayCount === 1 ? 'Termin' : 'Termine',
        detail: 'laut Kalender',
        alert: false,
      },
      {
        label: 'TÜV fällig',
        value: openTuv,
        unit: openTuv === 1 ? 'Fahrzeug' : 'Fahrzeuge',
        detail: `${tuvCounts.overdue} überfällig, ${tuvCounts.soon} in 30 Tagen`,
        alert: tuvCounts.overdue > 0,
      },
      {
        label: 'Bestätigt',
        value: confirmedRate,
        unit: '%',
        detail: `${confirmedCount} von ${todayCount} Terminen heute`,
        alert: false,
      },
    ];
  }, [todayAppointments, tuvCounts]);

  const openNewAppointmentModal = () => {
    setEditingAppointment(null);
    setIsModalOpen(true);
  };

  const openEditAppointmentModal = (appointment: Appointment) => {
    setEditingAppointment(appointment);
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
    setIsModalOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-100 md:h-screen md:overflow-hidden">
      <div className="flex flex-col md:h-full md:flex-row">
        <Sidebar />

        <main className="wp-stagger min-w-0 flex-1 bg-slate-50 px-4 py-6 md:h-full md:overflow-y-auto lg:px-10 lg:py-8">
          <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm text-slate-500">{workshopName}</p>
              <h1 className="mt-1 text-[28px] font-medium leading-tight text-slate-900">{dateLabel}</h1>
            </div>

            <button
              type="button"
              onClick={openNewAppointmentModal}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              Neuer Termin
            </button>
          </header>

          <OnboardingChecklist />

          <section className="mt-6 grid gap-px overflow-hidden rounded-3xl bg-slate-200 ring-1 ring-slate-200 sm:grid-cols-3">
            {kpis.map(({ label, value, unit, detail, alert }) => (
              <div key={label} className="bg-white px-5 py-5">
                <p className="text-sm text-slate-500">{label}</p>
                <p className="mt-2 flex items-baseline gap-1.5 text-slate-900">
                  <span className="text-[32px] font-medium leading-none">
                    <CountUp value={value} />
                  </span>
                  <span className="text-sm text-slate-500">{unit}</span>
                </p>
                <p className={`mt-3 text-[13px] ${alert ? 'text-rose-700' : 'text-slate-500'}`}>{detail}</p>
              </div>
            ))}
          </section>

          <section className="mt-8 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-medium text-slate-900">Heutige Termine & Wiedervorlagen</h2>
                <p className="text-sm text-slate-500">Veranstaltungen und Erinnerungen für den aktuellen Tag</p>
              </div>
              <Link
                href="/termine"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Alle ansehen
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>

            {appointmentError && (
              <p role="alert" className="mb-4 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700 ring-1 ring-rose-200">
                {appointmentError}
              </p>
            )}

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
                    <th className="px-3 py-3 font-medium text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {todayAppointments.map((appointment) => (
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
          </section>

          <section className="mt-6 flex flex-col gap-4 rounded-3xl bg-white p-5 ring-1 ring-slate-200 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-medium text-slate-900">TÜV-Erinnerungen</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                {tuvCounts.overdue + tuvCounts.soon > 0
                  ? `${tuvCounts.overdue + tuvCounts.soon === 1 ? '1 Fahrzeug ist' : `${tuvCounts.overdue + tuvCounts.soon} Fahrzeuge sind`} überfällig oder in den nächsten 30 Tagen fällig. Erinnerungen per WhatsApp oder E-Mail gehen nur an Kunden mit Einwilligung.`
                  : 'Zurzeit ist keine Hauptuntersuchung überfällig oder in den nächsten 30 Tagen fällig.'}
              </p>
            </div>
            <Link
              href="/tuv"
              className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100"
            >
              <MessageSquareText className="h-4 w-4 text-slate-500" />
              Zur Wiedervorlage
            </Link>
          </section>
        </main>
      </div>

      {isModalOpen && (
        <AppointmentModal
          appointment={editingAppointment}
          customers={customers}
          vehicles={customerVehicles}
          mechanics={mechanics}
          customersLoaded={customersLoaded}
          onUpdateVehicle={updateCustomerVehicle}
          onClose={() => {
            setIsModalOpen(false);
            setEditingAppointment(null);
          }}
          onSave={handleSaveAppointment}
        />
      )}
    </div>
  );
}
