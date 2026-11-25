'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, Wrench, X } from 'lucide-react';
import { buildWorkOrderLink } from '../lib/work-order-prefill';
import ConfirmDialog from './ConfirmDialog';
import {
  appointmentToForm,
  createDefaultFormState,
  getTodayDateString,
  type Appointment,
  type AppointmentForm,
  type AppointmentMechanic,
  type AppointmentStatus,
} from '../lib/appointments';
import type { Customer, Vehicle, VehicleInput } from '../lib/customers';
import { lookupKfzData } from '../lib/kfzLookup';
import { workstations } from '../lib/workshop';

type AppointmentModalProps = {
  appointment: Appointment | null;
  customers: Customer[];
  vehicles: Vehicle[];
  mechanics: AppointmentMechanic[];
  customersLoaded: boolean;
  initialCustomerId?: string;
  initialVehicleId?: string;
  initialDate?: string;
  initialTime?: string;
  initialBay?: string;
  initialMechanicId?: string;
  onUpdateVehicle: (id: string, input: VehicleInput) => void;
  onClose: () => void;
  onSave: (form: AppointmentForm) => void;
};

type PendingTuvUpdate = {
  form: AppointmentForm;
  date: string;
  displayDate: string;
};

function getAppointmentForm(appointment: Appointment | null): AppointmentForm {
  return appointment ? appointmentToForm(appointment) : createDefaultFormState();
}

function isTuvReason(reason: string): boolean {
  const normalizedReason = reason.toLocaleLowerCase('de-DE');
  return normalizedReason.includes('hauptuntersuchung') || normalizedReason.includes('tüv');
}

function getDateInTwoYears(): { date: string; displayDate: string } {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 2);
  return {
    date: getTodayDateString(date),
    displayDate: new Intl.DateTimeFormat('de-DE').format(date),
  };
}

export default function AppointmentModal({
  appointment,
  customers,
  vehicles,
  mechanics,
  customersLoaded,
  initialCustomerId,
  initialVehicleId,
  initialDate,
  initialTime,
  initialBay,
  initialMechanicId,
  onUpdateVehicle,
  onClose,
  onSave,
}: AppointmentModalProps) {
  const [formState, setFormState] = useState<AppointmentForm>(() => {
    const form = getAppointmentForm(appointment);
    return {
      ...form,
      customerId: appointment?.customerId ?? initialCustomerId,
      vehicleId: appointment?.vehicleId ?? initialVehicleId,
      date: appointment ? form.date : initialDate || form.date,
      time: appointment ? form.time : initialTime || form.time,
      bay: appointment ? form.bay : initialBay || form.bay,
      mechanicId: appointment ? form.mechanicId : initialMechanicId || form.mechanicId,
    };
  });
  const [selectedCustomerId, setSelectedCustomerId] = useState(
    appointment?.customerId ?? initialCustomerId ?? '',
  );
  const [selectedVehicleId, setSelectedVehicleId] = useState(
    appointment?.vehicleId ?? initialVehicleId ?? '',
  );
  const workOrderLink = appointment ? buildWorkOrderLink(appointment) : null;
  const [pendingTuvUpdate, setPendingTuvUpdate] = useState<PendingTuvUpdate | null>(null);
  const [isLookingUpKfz, setIsLookingUpKfz] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!customersLoaded || appointment || !initialCustomerId) return;

    const customer = customers.find((item) => item.id === initialCustomerId);
    if (!customer) {
      setSelectedCustomerId('');
      setSelectedVehicleId('');
      setFormState((current) => ({ ...current, customerId: undefined, vehicleId: undefined }));
      return;
    }

    const vehicle = vehicles.find(
      (item) => item.id === initialVehicleId && item.customerId === customer.id,
    );
    setSelectedCustomerId(customer.id);
    setSelectedVehicleId(vehicle?.id ?? '');
    setFormState((current) => ({
      ...current,
      customer: customer.name,
      vehicle: vehicle?.make ?? '',
      plate: vehicle?.plate ?? '',
      vehicleYear: vehicle?.year,
      hsn: vehicle?.hsn,
      tsn: vehicle?.tsn,
      vin: vehicle?.vin,
      engine: vehicle?.engine,
      tuvIntervalMonths: vehicle?.tuvIntervalMonths,
      tuvDueDate: vehicle?.tuvDueDate,
      customerId: customer.id,
      vehicleId: vehicle?.id,
    }));
  }, [appointment, customers, customersLoaded, initialCustomerId, initialVehicleId, vehicles]);

  const handleCustomerSelection = (customerId: string) => {
    setSelectedCustomerId(customerId);
    setSelectedVehicleId('');

    if (!customerId) {
      setFormState((current) => ({
        ...current,
        customer: '',
        vehicle: '',
        plate: '',
        vehicleYear: undefined,
        hsn: undefined,
        tsn: undefined,
        vin: undefined,
        engine: undefined,
        tuvIntervalMonths: undefined,
        tuvDueDate: undefined,
        customerId: undefined,
        vehicleId: undefined,
      }));
      return;
    }

    const customer = customers.find((item) => item.id === customerId);
    setFormState((current) => ({
      ...current,
      customer: customer?.name ?? '',
      vehicle: '',
      plate: '',
      vehicleYear: undefined,
      hsn: undefined,
      tsn: undefined,
      vin: undefined,
      engine: undefined,
      tuvIntervalMonths: undefined,
      tuvDueDate: undefined,
      customerId,
      vehicleId: undefined,
    }));
  };

  const handleVehicleSelection = (vehicleId: string) => {
    setSelectedVehicleId(vehicleId);
    const vehicle = vehicles.find((item) => item.id === vehicleId);
    setFormState((current) => ({
      ...current,
      vehicle: vehicle?.make ?? '',
      plate: vehicle?.plate ?? '',
      vehicleYear: vehicle?.year,
      hsn: vehicle?.hsn,
      tsn: vehicle?.tsn,
      vin: vehicle?.vin,
      engine: vehicle?.engine,
      tuvIntervalMonths: vehicle?.tuvIntervalMonths,
      tuvDueDate: vehicle?.tuvDueDate,
      vehicleId: vehicle?.id,
    }));
  };

  const handleChange = <K extends keyof AppointmentForm>(field: K, value: AppointmentForm[K]) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  };

  const handleKfzLookup = async () => {
    setIsLookingUpKfz(true);
    setLookupMessage(null);
    try {
      const vin = formState.vin?.trim();
      const plate = formState.plate.trim();
      const result = lookupKfzData(vin
        ? { vin }
        : plate
          ? { plate }
          : { hsn: formState.hsn, tsn: formState.tsn });
      if (!result) {
        setLookupMessage({ tone: 'error', text: 'Keine lokalen Fahrzeugdaten gefunden. Bitte trage das Fahrzeug manuell ein.' });
        return;
      }
      setFormState((current) => ({
        ...current,
        vehicle: `${result.make} ${result.model} (${result.year})`,
        plate: result.plate,
        vehicleYear: result.year,
        hsn: result.hsn,
        tsn: result.tsn,
        vin: result.vin,
        engine: result.engine,
        tuvIntervalMonths: result.tuvIntervalMonths,
        tuvDueDate: result.tuvDueDate,
      }));
      setLookupMessage({
        tone: 'success',
        text: result.tuvDueDate
          ? `Lokale Fahrzeugdaten übernommen (${result.source}).`
          : `Lokale Fahrzeugdaten übernommen (${result.source}). Die HU-Fälligkeit bitte dem Prüfbericht entnehmen.`,
      });
    } catch (error) {
      setLookupMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Die Fahrzeugdaten konnten nicht abgerufen werden.',
      });
    } finally {
      setIsLookingUpKfz(false);
    }
  };

  const saveAppointment = (form: AppointmentForm, tuvDateOverride?: string) => {
    const linkedVehicle = form.vehicleId ? vehicles.find((vehicle) => vehicle.id === form.vehicleId) : undefined;
    if (linkedVehicle && form.vehicleYear !== undefined && form.hsn && form.tsn) {
      onUpdateVehicle(linkedVehicle.id, {
        customerId: linkedVehicle.customerId,
        make: form.vehicle,
        plate: form.plate,
        tuvDueDate: tuvDateOverride ?? (form.tuvDueDate || linkedVehicle.tuvDueDate),
        year: form.vehicleYear,
        hsn: form.hsn,
        tsn: form.tsn,
        vin: form.vin,
        engine: form.engine,
        tuvIntervalMonths: form.tuvIntervalMonths,
      });
    } else if (linkedVehicle && tuvDateOverride) {
      onUpdateVehicle(linkedVehicle.id, {
        customerId: linkedVehicle.customerId,
        make: linkedVehicle.make,
        plate: linkedVehicle.plate,
        tuvDueDate: tuvDateOverride,
        year: linkedVehicle.year,
        hsn: linkedVehicle.hsn,
        tsn: linkedVehicle.tsn,
        vin: linkedVehicle.vin,
        engine: linkedVehicle.engine,
        tuvIntervalMonths: linkedVehicle.tuvIntervalMonths,
      });
    }
    onSave(form);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const linkedVehicle = formState.vehicleId
      ? vehicles.find((vehicle) => vehicle.id === formState.vehicleId)
      : undefined;
    if (
      formState.status === 'Abgeschlossen' &&
      appointment?.status !== 'Abgeschlossen' &&
      isTuvReason(formState.reason) &&
      linkedVehicle
    ) {
      setPendingTuvUpdate({ form: formState, ...getDateInTwoYears() });
      return;
    }

    saveAppointment(formState);
  };

  const saveWithTuvUpdate = () => {
    if (!pendingTuvUpdate) return;
    const vehicle = vehicles.find((item) => item.id === pendingTuvUpdate.form.vehicleId);
    if (!vehicle) {
      console.error('Das verknüpfte Fahrzeug wurde nicht gefunden; das TÜV-Datum wurde nicht geändert.');
      setPendingTuvUpdate(null);
      onSave(pendingTuvUpdate.form);
      return;
    }

    setPendingTuvUpdate(null);
    saveAppointment(pendingTuvUpdate.form, pendingTuvUpdate.date);
  };

  const saveWithoutTuvUpdate = () => {
    if (!pendingTuvUpdate) return;
    setPendingTuvUpdate(null);
    saveAppointment(pendingTuvUpdate.form);
  };

  return (
    <div className="wp-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center overflow-y-auto bg-slate-950/40 p-4">
      <div className="wp-sheet mt-auto sm:my-auto max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-500">
              {appointment ? 'Termin bearbeiten' : 'Neuer Termin'}
            </p>
            <h3 className="mt-2 text-2xl font-medium text-slate-900">
              {appointment ? 'Termin bearbeiten' : 'Termin anlegen'}
            </h3>
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

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <label className="block text-sm font-medium text-slate-700">
            Kunde
            <select
              value={selectedCustomerId}
              onChange={(event) => handleCustomerSelection(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
            >
              <option value="">Neuer Kunde / manuell eingeben</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>

          {selectedCustomerId && (
            <label className="block text-sm font-medium text-slate-700">
              Fahrzeug
              <select
                value={selectedVehicleId}
                onChange={(event) => handleVehicleSelection(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
              >
                <option value="">Fahrzeug auswählen</option>
                {vehicles
                  .filter((vehicle) => vehicle.customerId === selectedCustomerId)
                  .map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.make} · {vehicle.plate}
                    </option>
                  ))}
              </select>
            </label>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Kundenname
              <input
                value={formState.customer}
                onChange={(event) => handleChange('customer', event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                placeholder="z. B. Müller, Anna"
                required
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Fahrzeug / Modell
              <input
                value={formState.vehicle}
                onChange={(event) => handleChange('vehicle', event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                placeholder="z. B. VW Golf"
                required
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <label className="block text-sm font-medium text-slate-700">
                Kennzeichen
                <input
                  value={formState.plate}
                  onChange={(event) => {
                    const plate = event.target.value;
                    setFormState((current) => {
                      const hasExistingRegistration = Boolean(current.vin?.trim());
                      return {
                        ...current,
                        plate,
                        ...(hasExistingRegistration
                          ? { vehicleYear: undefined, hsn: undefined, tsn: undefined, vin: undefined, engine: undefined, tuvIntervalMonths: undefined, tuvDueDate: undefined }
                          : {}),
                      };
                    });
                    setLookupMessage(null);
                  }}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                  placeholder="z. B. S-WN 1234"
                  required
                />
              </label>
              <button type="button" onClick={() => void handleKfzLookup()} disabled={isLookingUpKfz || (!formState.plate.trim() && !formState.vin?.trim() && !(formState.hsn?.trim() && formState.tsn?.trim()))} className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-accent-700 hover:bg-slate-200/70 disabled:cursor-not-allowed disabled:opacity-50">
                <Search className="h-4 w-4" />{isLookingUpKfz ? 'Lokale Daten werden gesucht …' : 'Kfz-Daten abrufen'}
              </button>
              <p className="text-xs text-slate-500">Lokale Beispieldaten, keine vollständige amtliche KBA-Datenbank. HU-Fälligkeit bitte anhand des Prüfberichts bestätigen.</p>
              {lookupMessage && <p role={lookupMessage.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl p-3 text-xs ${lookupMessage.tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{lookupMessage.text}</p>}
            </div>

            <label className="block text-sm font-medium text-slate-700">
              Status
              <select
                value={formState.status}
                onChange={(event) => handleChange('status', event.target.value as AppointmentStatus)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
              >
                <option value="Bestätigt">Bestätigt</option>
                <option value="Ausstehend">Ausstehend</option>
                <option value="Abgeschlossen">Abgeschlossen</option>
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Fahrzeug-Identifizierungsnummer (FIN), optional
              <input value={formState.vin ?? ''} onChange={(event) => {
                setFormState((current) => ({
                  ...current,
                  vin: event.target.value.toUpperCase(),
                  vehicleYear: undefined,
                  hsn: undefined,
                  tsn: undefined,
                  engine: undefined,
                  tuvIntervalMonths: undefined,
                  tuvDueDate: undefined,
                }));
                setLookupMessage(null);
              }} maxLength={17} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-slate-900 outline-none focus:border-accent-600" placeholder="17-stellige Fahrzeugnummer" />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="block text-sm font-medium text-slate-700">Baujahr<input type="number" value={formState.vehicleYear ?? ''} onChange={(event) => handleChange('vehicleYear', event.target.value ? Number(event.target.value) : undefined)} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" /></label>
              <label className="block text-sm font-medium text-slate-700">HSN<input value={formState.hsn ?? ''} onChange={(event) => handleChange('hsn', event.target.value.toUpperCase())} maxLength={4} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" /></label>
              <label className="block text-sm font-medium text-slate-700">TSN<input value={formState.tsn ?? ''} onChange={(event) => handleChange('tsn', event.target.value.toUpperCase())} maxLength={3} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" /></label>
            </div>
          </div>
          {formState.engine && <p className="text-sm text-slate-600">Motorisierung: {formState.engine}{formState.tuvIntervalMonths ? ` · HU-Prüfintervall: ${formState.tuvIntervalMonths} Monate` : ''}</p>}
          {formState.tuvDueDate && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">HU fällig bis: <strong>{new Intl.DateTimeFormat('de-DE').format(new Date(`${formState.tuvDueDate}T00:00:00`))}</strong></p>}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Datum
              <input
                type="date"
                value={formState.date}
                onChange={(event) => handleChange('date', event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                required
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Uhrzeit
              <input
                type="time"
                value={formState.time}
                onChange={(event) => handleChange('time', event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                required
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="block text-sm font-medium text-slate-700">
              Dauer (Minuten)
              <input
                type="number"
                min={5}
                max={1440}
                step={1}
                value={formState.durationMinutes}
                onChange={(event) => handleChange('durationMinutes', Number(event.target.value))}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                required
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Arbeitsplatz / Hebebühne
              <input
                list="appointment-workstations"
                value={formState.bay}
                onChange={(event) => handleChange('bay', event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                placeholder="z. B. Direktannahme"
                required
              />
              <datalist id="appointment-workstations">
                {workstations.map((workstation) => (
                  <option key={workstation} value={workstation} />
                ))}
              </datalist>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Mechaniker
              <select
                value={formState.mechanicId ?? ''}
                onChange={(event) => handleChange('mechanicId', event.target.value || undefined)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
              >
                <option value="">Nicht zugewiesen</option>
                {mechanics.map((mechanic) => (
                  <option key={mechanic.id} value={mechanic.id}>
                    {mechanic.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block text-sm font-medium text-slate-700">
            Grund / Service
            <input
              value={formState.reason}
              onChange={(event) => handleChange('reason', event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
              placeholder="z. B. Hauptuntersuchung / TÜV"
            />
          </label>

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            {appointment && (
              workOrderLink ? (
                <Link
                  href={workOrderLink}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm font-medium text-accent-700 transition hover:bg-slate-200/70 sm:mr-auto"
                >
                  <Wrench className="h-4 w-4" />
                  Auftrag anlegen
                </Link>
              ) : (
                <span
                  title="Wähle im Termin einen Kunden und ein Fahrzeug aus der Liste aus und speichere ihn, dann kann daraus ein Auftrag entstehen."
                  className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-400 sm:mr-auto"
                >
                  <Wrench className="h-4 w-4" />
                  Auftrag anlegen
                </span>
              )
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={!customersLoaded}
              className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {appointment ? 'Änderungen speichern' : 'Termin speichern'}
            </button>
          </div>
        </form>
      </div>
      {pendingTuvUpdate && (
        <ConfirmDialog
          title="TÜV-Datum aktualisieren?"
          message={`TÜV-Datum des Fahrzeugs auf ${pendingTuvUpdate.displayDate} setzen?`}
          cancelLabel="Nein"
          confirmLabel="Ja"
          confirmVariant="primary"
          onCancel={saveWithoutTuvUpdate}
          onConfirm={saveWithTuvUpdate}
        />
      )}
    </div>
  );
}
