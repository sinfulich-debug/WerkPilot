'use client';

import { useState } from 'react';
import { Camera, Search, X } from 'lucide-react';
import type { Vehicle, VehicleInput } from '../lib/customers';
import { lookupKfzData } from '../lib/kfzLookup';
import { parseFahrzeugscheinText } from '../lib/fahrzeugschein';
import { checkScanFile, recognizeFahrzeugschein } from '../lib/fahrzeugschein-ocr';

type VehicleModalProps = {
  customerId: string;
  vehicle: Vehicle | null;
  onClose: () => void;
  onSave: (input: VehicleInput) => void;
};

export default function VehicleModal({ customerId, vehicle, onClose, onSave }: VehicleModalProps) {
  const [formState, setFormState] = useState<Omit<VehicleInput, 'customerId'>>(() => ({
    make: vehicle?.make ?? '',
    plate: vehicle?.plate ?? '',
    tuvDueDate: vehicle?.tuvDueDate ?? '',
    year: vehicle?.year,
    hsn: vehicle?.hsn ?? '',
    tsn: vehicle?.tsn ?? '',
    vin: vehicle?.vin ?? '',
    engine: vehicle?.engine ?? '',
    tuvIntervalMonths: vehicle?.tuvIntervalMonths,
  }));
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  // Related fields are cleared on edit only when the lookup filled them; typed or scanned values are kept.
  const [lookupFilled, setLookupFilled] = useState(false);

  const handleLookup = async () => {
    setIsLookingUp(true);
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
        setShowManualEntry(true);
        setLookupMessage({ tone: 'error', text: 'Keine lokalen Fahrzeugdaten gefunden. Bitte trage das Fahrzeug manuell ein.' });
        return;
      }
      setFormState((current) => ({
        ...current,
        make: `${result.make} ${result.model}`,
        plate: result.plate,
        tuvDueDate: result.tuvDueDate,
        year: result.year,
        hsn: result.hsn,
        tsn: result.tsn,
        vin: result.vin,
        engine: result.engine,
        tuvIntervalMonths: result.tuvIntervalMonths,
      }));
      setShowManualEntry(false);
      setLookupFilled(true);
      setLookupMessage({
        tone: 'success',
        text: result.tuvDueDate
          ? `Lokale Fahrzeugdaten übernommen (${result.source}).`
          : `Lokale Fahrzeugdaten übernommen (${result.source}). Die HU-Fälligkeit bitte dem Prüfbericht entnehmen.`,
      });
    } catch (error) {
      setShowManualEntry(true);
      setLookupMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Die Fahrzeugdaten konnten nicht abgerufen werden.',
      });
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleScan = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const problem = checkScanFile(file);
    if (problem) {
      setLookupMessage({ tone: 'error', text: problem });
      return;
    }
    setIsScanning(true);
    setLookupFilled(false);
    setLookupMessage(null);
    try {
      const found = parseFahrzeugscheinText(await recognizeFahrzeugschein(file));
      const labels = [
        found.vin && 'FIN',
        found.hsn && 'HSN',
        found.tsn && 'TSN',
        found.year && 'Baujahr',
      ].filter(Boolean);
      if (labels.length === 0) {
        setLookupMessage({ tone: 'error', text: 'Auf dem Foto konnte nichts gelesen werden. Bitte ein schärferes, gerades Foto versuchen oder manuell eintragen.' });
        return;
      }
      setFormState((current) => ({
        ...current,
        ...(found.vin ? { vin: found.vin } : {}),
        ...(found.hsn ? { hsn: found.hsn } : {}),
        ...(found.tsn ? { tsn: found.tsn } : {}),
        ...(found.year ? { year: found.year } : {}),
      }));
      setLookupMessage({
        tone: 'success',
        text: `Gelesen: ${labels.join(', ')}. Bitte alle Werte mit dem Fahrzeugschein vergleichen. Das Foto wurde nicht gespeichert.`,
      });
    } catch {
      setLookupMessage({ tone: 'error', text: 'Das Foto konnte nicht gelesen werden. Bitte manuell eintragen.' });
    } finally {
      setIsScanning(false);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({ ...formState, customerId });
  };

  return (
    <div className="wp-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center overflow-y-auto bg-slate-950/40 p-4">
      <div className="wp-sheet mt-auto sm:my-auto max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-500">
              {vehicle ? 'Fahrzeug bearbeiten' : 'Neues Fahrzeug'}
            </p>
            <h2 className="mt-2 text-2xl font-medium text-slate-900">
              {vehicle ? 'Fahrzeugdaten bearbeiten' : 'Fahrzeug hinzufügen'}
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

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          {showManualEntry && (
            <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-medium">Fahrzeug manuell eintragen</p>
              <p className="mt-1">Die Felder unten können ohne lokale Zuordnung ausgefüllt werden.</p>
            </div>
          )}
          <label className="block text-sm font-medium text-slate-700">
            Marke / Modell
            <input
              value={formState.make}
              onChange={(event) => setFormState((current) => ({ ...current, make: event.target.value }))}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
              placeholder="z. B. VW Golf"
              required
            />
          </label>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">
              Kennzeichen
              <input
                value={formState.plate}
                onChange={(event) => {
                  setFormState((current) => {
                    const hasExistingRegistration = lookupFilled && Boolean(current.vin?.trim());
                    return {
                      ...current,
                      plate: event.target.value,
                      ...(hasExistingRegistration
                        ? { vin: '', year: undefined, hsn: '', tsn: '', engine: '', tuvIntervalMonths: undefined, tuvDueDate: '' }
                        : {}),
                    };
                  });
                  setLookupFilled(false);
                  setLookupMessage(null);
                  setShowManualEntry(false);
                }}
                className="mt-2 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                placeholder="z. B. S-WN 1234"
                required
              />
            </label>
            <button
              type="button"
              onClick={() => void handleLookup()}
              disabled={
                isLookingUp ||
                (!formState.plate.trim() &&
                  !formState.vin?.trim() &&
                  !(formState.hsn?.trim() && formState.tsn?.trim()))
              }
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 text-sm font-medium text-accent-700 transition hover:bg-slate-200/70 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Search className="h-4 w-4" />
              {isLookingUp ? 'Lokale Daten werden gesucht …' : 'Kfz-Daten abrufen'}
            </button>
            <p className="text-xs leading-relaxed text-slate-500">
              Lokale Beispieldaten, keine vollständige amtliche KBA-Datenbank. HU-Fälligkeit bitte anhand des Prüfberichts bestätigen.
            </p>
          </div>

          <div className="space-y-2">
            <label className={`inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100 ${isScanning ? 'pointer-events-none opacity-50' : ''}`}>
              <Camera className="h-4 w-4" />
              {isScanning ? 'Fahrzeugschein wird gelesen …' : 'Fahrzeugschein scannen'}
              <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={isScanning} onChange={(event) => void handleScan(event)} />
            </label>
            <p className="text-xs leading-relaxed text-slate-500">
              Das Foto wird nur auf diesem Gerät gelesen und nicht hochgeladen oder gespeichert.
            </p>
          </div>

          <label className="block text-sm font-medium text-slate-700">
            Fahrzeug-Identifizierungsnummer (FIN), optional
            <input
              value={formState.vin ?? ''}
              onChange={(event) => {
                setFormState((current) => ({
                  ...current,
                  vin: event.target.value.toUpperCase(),
                  ...(lookupFilled
                    ? { year: undefined, hsn: '', tsn: '', engine: '', tuvIntervalMonths: undefined, tuvDueDate: '' }
                    : {}),
                }));
                setLookupFilled(false);
                setLookupMessage(null);
                setShowManualEntry(false);
              }}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
              placeholder="17-stellige Fahrzeugnummer"
              maxLength={17}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block text-sm font-medium text-slate-700">Baujahr
              <input type="number" min="1900" max={new Date().getFullYear() + 1} value={formState.year ?? ''} onChange={(event) => setFormState((current) => ({ ...current, year: event.target.value ? Number(event.target.value) : undefined }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" />
            </label>
            <label className="block text-sm font-medium text-slate-700">HSN
              <input value={formState.hsn ?? ''} onChange={(event) => setFormState((current) => ({ ...current, hsn: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" maxLength={4} />
            </label>
            <label className="block text-sm font-medium text-slate-700">TSN
              <input value={formState.tsn ?? ''} onChange={(event) => setFormState((current) => ({ ...current, tsn: event.target.value.toUpperCase() }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" maxLength={3} />
            </label>
          </div>

          <label className="block text-sm font-medium text-slate-700">Motorisierung
            <input value={formState.engine ?? ''} onChange={(event) => setFormState((current) => ({ ...current, engine: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" placeholder="z. B. 2,0 l Diesel, 110 kW" />
          </label>
          {formState.tuvIntervalMonths && <p className="text-xs text-slate-500">Üblicher HU-Prüfintervall: {formState.tuvIntervalMonths} Monate. Die tatsächliche Fälligkeit bitte anhand des Prüfberichts bestätigen.</p>}

          {lookupMessage && <p role={lookupMessage.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl p-3 text-sm ${lookupMessage.tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{lookupMessage.text}</p>}

          <label className="block text-sm font-medium text-slate-700">
            TÜV fällig bis
            <input
              type="date"
              value={formState.tuvDueDate}
              onChange={(event) => setFormState((current) => ({ ...current, tuvDueDate: event.target.value }))}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
              required
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
              {vehicle ? 'Änderungen speichern' : 'Fahrzeug speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
