'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileUp, Upload } from 'lucide-react';
import Sidebar from '../../../components/Sidebar';
import {
  buildImportPreview,
  decodeCsvBytes,
  IMPORT_FIELD_LABELS,
  IMPORT_FIELDS,
  MAX_IMPORT_BYTES,
  type ColumnMapping,
  type ImportField,
} from '../../../lib/customer-import';

type ImportResult = {
  newCustomers: number;
  existingCustomers: number;
  newVehicles: number;
  skippedVehicles: number;
  invalidRows: number;
};

const PREVIEW_ROWS = 50;

export default function CustomerImportPage() {
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const preview = useMemo(() => (csv ? buildImportPreview(csv, mapping ?? undefined) : null), [csv, mapping]);

  const summary = useMemo(() => {
    if (!preview) return null;
    const valid = preview.rows.filter((row) => row.customer);
    return {
      valid: valid.length,
      invalid: preview.rows.length - valid.length,
      vehicles: valid.filter((row) => row.vehicle).length,
      warnings: preview.rows.filter((row) => row.warnings.length > 0).length,
    };
  }, [preview]);

  const handleFile = async (file: File | undefined) => {
    setResult(null);
    setSaveError(null);
    setFileError(null);
    setCsv('');
    setMapping(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setFileError('Die Datei ist zu groß (höchstens 2 MB). Bitte in mehrere Dateien aufteilen.');
      return;
    }
    const text = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
    setFileName(file.name);
    setCsv(text);
    setMapping(buildImportPreview(text).mapping);
  };

  const setColumn = (field: ImportField, value: string) => {
    setMapping((current) => {
      const next = { ...(current ?? {}) };
      if (value === '') delete next[field];
      else next[field] = Number(value);
      return next;
    });
  };

  const handleImport = async () => {
    if (!preview || preview.error || !mapping) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch('/kunden/import/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, mapping }),
      });
      const data = (await response.json()) as { ok: boolean; error?: string; result?: ImportResult };
      if (!response.ok || !data.ok || !data.result) throw new Error(data.error ?? 'Der Import ist fehlgeschlagen.');
      setResult(data.result);
      setCsv('');
      setMapping(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Der Import ist fehlgeschlagen.');
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
            <Link href="/kunden" className="inline-flex items-center gap-1 text-sm font-medium text-accent-700 hover:text-accent-600">
              <ArrowLeft className="h-4 w-4" /> Zurück zu Kunden
            </Link>
            <p className="mt-4 text-sm font-medium text-slate-500">Kundenverwaltung</p>
            <h1 className="mt-2 text-3xl font-medium tracking-tight text-slate-900">Kunden & Fahrzeuge importieren</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              CSV-Datei aus Excel oder Ihrer bisherigen Werkstattsoftware hochladen. Eine Zeile pro Fahrzeug; ein Kunde
              mit mehreren Fahrzeugen darf mehrfach vorkommen. Vorhandene Kunden (gleiche E-Mail oder gleicher Name und
              Telefon) werden nicht verändert, bereits vorhandene Kennzeichen werden übersprungen.
            </p>
          </header>

          {result && (
            <section className="mt-6 rounded-3xl bg-emerald-50 p-5 ring-1 ring-emerald-200">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
                <div className="text-sm text-emerald-900">
                  <p className="font-medium">Import abgeschlossen</p>
                  <p className="mt-1">
                    {result.newCustomers} neue Kunden, {result.newVehicles} neue Fahrzeuge
                    {result.existingCustomers > 0 && `, ${result.existingCustomers} Kunden waren schon vorhanden`}
                    {result.skippedVehicles > 0 && `, ${result.skippedVehicles} Fahrzeuge übersprungen (Kennzeichen vorhanden)`}
                    {result.invalidRows > 0 && `, ${result.invalidRows} fehlerhafte Zeilen ausgelassen`}.
                  </p>
                  <p className="mt-2 text-emerald-800">
                    Hinweis: Für importierte Kunden ist keine Einwilligung für HU-Erinnerungen gespeichert. Bitte die
                    Einwilligung beim nächsten Kontakt einholen und in der Kundenkarte erfassen.
                  </p>
                  <Link href="/kunden" className="mt-3 inline-block font-medium text-emerald-700 underline">
                    Zu den Kunden
                  </Link>
                </div>
              </div>
            </section>
          )}

          <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-8 text-center transition hover:border-slate-400 hover:bg-slate-200/70">
              <FileUp className="h-8 w-8 text-accent-700" />
              <span className="text-sm font-medium text-slate-800">{fileName || 'CSV-Datei auswählen'}</span>
              <span className="text-xs text-slate-500">Trennzeichen ; , oder Tab · UTF-8 oder Excel (ANSI) · bis 2 MB</span>
              <input
                type="file"
                accept=".csv,.txt,text/csv"
                className="sr-only"
                onChange={(event) => {
                  void handleFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
            {fileError && <p className="mt-3 text-sm text-rose-600">{fileError}</p>}
          </section>

          {preview && (
            <>
              <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <h2 className="text-lg font-medium text-slate-900">Spalten zuordnen</h2>
                <p className="mt-1 text-sm text-slate-500">Automatisch erkannt, bitte prüfen. Pflicht: Name (oder Vor-/Nachname). Für Fahrzeuge: Kennzeichen, Marke und HU-Datum.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {IMPORT_FIELDS.map((field) => (
                    <label key={field} className="block text-sm font-medium text-slate-700">
                      {IMPORT_FIELD_LABELS[field]}
                      <select
                        value={mapping?.[field] ?? ''}
                        onChange={(event) => setColumn(field, event.target.value)}
                        className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                      >
                        <option value="">— nicht importieren —</option>
                        {preview.headers.map((header, index) => (
                          <option key={index} value={index}>
                            {header || `Spalte ${index + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </section>

              <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-medium text-slate-900">Vorschau</h2>
                    {summary && !preview.error && (
                      <p className="mt-1 text-sm text-slate-500">
                        {summary.valid} Zeilen gültig ({summary.vehicles} mit Fahrzeug), {summary.invalid} fehlerhaft, {summary.warnings} mit Hinweisen.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleImport}
                    disabled={saving || Boolean(preview.error) || !summary?.valid}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Upload className="h-4 w-4" />
                    {saving ? 'Wird importiert…' : `${summary?.valid ?? 0} Zeilen importieren`}
                  </button>
                </div>

                {preview.error && <p className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{preview.error}</p>}
                {saveError && <p className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{saveError}</p>}

                {!preview.error && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="text-[13px] text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Zeile</th>
                          <th className="px-3 py-2">Kunde</th>
                          <th className="px-3 py-2">Kontakt</th>
                          <th className="px-3 py-2">Fahrzeug</th>
                          <th className="px-3 py-2">HU</th>
                          <th className="px-3 py-2">Hinweise</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {preview.rows.slice(0, PREVIEW_ROWS).map((row) => (
                          <tr key={row.line} className={row.customer ? '' : 'bg-rose-50/60'}>
                            <td className="px-3 py-2 text-slate-400">{row.line}</td>
                            <td className="px-3 py-2 font-medium text-slate-800">{row.customer?.name ?? '—'}</td>
                            <td className="px-3 py-2 text-slate-600">{[row.customer?.phone, row.customer?.email].filter(Boolean).join(' · ')}</td>
                            <td className="px-3 py-2 text-slate-600">{row.vehicle ? `${row.vehicle.plate} · ${[row.vehicle.make, row.vehicle.model].filter(Boolean).join(' ')}` : ''}</td>
                            <td className="px-3 py-2 text-slate-600">{row.vehicle?.huDueDate.split('-').reverse().join('.') ?? ''}</td>
                            <td className="px-3 py-2">
                              {[...row.errors, ...row.warnings].map((message) => (
                                <p key={message} className={`flex items-start gap-1 text-xs ${row.errors.includes(message) ? 'text-rose-700' : 'text-amber-700'}`}>
                                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {message}
                                </p>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {preview.rows.length > PREVIEW_ROWS && (
                      <p className="mt-3 text-xs text-slate-500">
                        Es werden die ersten {PREVIEW_ROWS} von {preview.rows.length} Zeilen angezeigt; importiert werden alle gültigen Zeilen.
                      </p>
                    )}
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
