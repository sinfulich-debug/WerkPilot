'use client';

import { Suspense, useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Camera, Check, ClipboardCheck, Copy, Gauge, Link2, Plus, ReceiptText, Wrench } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import { formatEuro, workOrderLineMarginCents, workOrderTotals } from '../../lib/money';
import { useCustomers } from '../../lib/hooks/useCustomers';
import { useParts } from '../../lib/hooks/useParts';
import { useWorkOrders } from '../../lib/hooks/useWorkOrders';
import { useApprovals } from '../../lib/hooks/useApprovals';
import {
  buildApprovalShareMessage,
  buildApprovalUrl,
  describeApprovalForStaff,
  pickRelevantApproval,
  type ApprovalBadgeTone,
} from '../../lib/estimate-approval';
import { getMailtoLink, getWhatsAppLink } from '../../lib/reminders';
import { useInspections } from '../../lib/hooks/useInspections';
import { useWorkshopSettings } from '../../lib/hooks/useWorkshopSettings';
import { centsToEuros } from '../../lib/workshop-settings';
import { INSPECTION_STATUSES, type InspectionStatus } from '../../lib/inspections';
import { parseWorkOrderPrefill, type WorkOrderPrefill } from '../../lib/work-order-prefill';
import {
  mechanicOptions,
  UNASSIGNED_MECHANIC,
  workstations,
  type EstimateItem,
  type WorkOrder,
  type WorkOrderLine,
} from '../../lib/workshop';
import { getAllowedWorkOrderTransitions, type WorkOrderStatus } from '../../lib/work-order-status';

type WorkshopTab = 'board' | 'inspection' | 'estimates';
const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const workOrderStatusNames: Record<WorkOrderStatus, string> = {
  draft: 'Entwurf',
  estimate: 'Kostenvoranschlag',
  approved: 'Freigegeben',
  in_progress: 'In Arbeit',
  completed: 'Abgeschlossen',
  invoiced: 'Rechnung erstellt',
};
const workOrderStatusStyles: Record<WorkOrderStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  estimate: 'bg-amber-100 text-amber-800',
  approved: 'bg-slate-100 text-slate-800',
  in_progress: 'bg-accent-50 text-accent-800',
  completed: 'bg-emerald-100 text-emerald-800',
  invoiced: 'bg-slate-100 text-slate-500',
};
const approvalToneStyles: Record<ApprovalBadgeTone, string> = {
  info: 'bg-slate-100 text-slate-800',
  success: 'bg-emerald-50 text-emerald-800',
  warning: 'bg-amber-50 text-amber-900',
  danger: 'bg-rose-50 text-rose-800',
  neutral: 'bg-slate-100 text-slate-600',
};
const statusNames: Record<InspectionStatus, string> = { gruen: 'Ohne Befund', gelb: 'Beobachten', rot: 'Handlungsbedarf' };
const statusStyles: Record<InspectionStatus, string> = {
  gruen: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  gelb: 'bg-amber-100 text-amber-800 ring-amber-200',
  rot: 'bg-rose-100 text-rose-800 ring-rose-200',
};

function lineMarginLabel(line: WorkOrderLine): string {
  const marginCents = workOrderLineMarginCents({
    kind: line.kind,
    qtyMilli: Math.round(line.quantity * 1_000),
    unitPriceCents: Math.round(line.unitPrice * 100),
    taxRateBp: line.taxRateBp,
    discountBp: line.discountBp,
    purchasePriceCents: line.purchasePriceCents,
  });
  return marginCents === null ? '' : ` · Marge ${formatEuro(marginCents)}`;
}

async function compressPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Bitte wähle eine Bilddatei aus.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Das Bild darf höchstens 12 MB groß sein.');

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Das Bild konnte nicht verarbeitet werden.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

/** Opens the estimate form filled in when the page is reached via "Auftrag anlegen" from an appointment. */
function WorkOrderPrefillWatcher({ onPrefill }: { onPrefill: (prefill: WorkOrderPrefill) => void }) {
  const searchParams = useSearchParams();
  const prefill = useMemo(() => parseWorkOrderPrefill(searchParams), [searchParams]);

  useEffect(() => {
    if (prefill) onPrefill(prefill);
  }, [onPrefill, prefill]);

  return null;
}

export default function WorkshopPage() {
  const router = useRouter();
  const {
    inspections,
    photos: inspectionPhotos,
    isLoaded: inspectionsLoaded,
    error: inspectionsError,
    notice: inspectionsNotice,
    addInspection: createInspection,
    updateHeader: updateInspectionHeader,
    setItemStatus: setInspectionItemStatus,
    setItemNote: setInspectionItemNote,
    setPhoto: saveInspectionPhoto,
    removePhoto: removeInspectionPhoto,
    loadPhoto: loadInspectionPhoto,
  } = useInspections();
  const {
    workOrders,
    canCreateInvoice,
    canViewCosts,
    mechanicNames,
    isLoaded: workOrdersLoaded,
    error: workOrdersError,
    addWorkOrder,
    setWorkOrderStatus,
    updateAssignment,
    createInvoiceFromWorkOrder,
  } = useWorkOrders();
  const {
    customers,
    vehicles,
    isLoaded: customerDataLoaded,
    error: customerDataError,
  } = useCustomers();
  const {
    parts: stockParts,
    isLoaded: stockPartsLoaded,
    error: stockPartsError,
  } = useParts();
  const { approvals, error: approvalsError, createLink, revokeLink } = useApprovals();
  // links made in this session, with the address to copy (the secret part cannot be read again later)
  const [shareLinks, setShareLinks] = useState<Record<string, { url: string; expiresAt: string }>>({});
  const [copiedFor, setCopiedFor] = useState('');
  const [activeTab, setActiveTab] = useState<WorkshopTab>('board');
  const [selectedInspection, setSelectedInspection] = useState('');
  const [photoError, setPhotoError] = useState('');
  const { settings: workshopSettings, error: workshopSettingsError } = useWorkshopSettings();
  const hourlyRate = centsToEuros(workshopSettings.hourlyRateCents);
  const settingsWarning = workshopSettingsError
    ? `${workshopSettingsError} Es wird der Richtwert von 95 € verwendet.`
    : '';
  const [estimateForm, setEstimateForm] = useState({ customerId: '', vehicleId: '', service: '', hours: 1, parts: 0 });
  const [estimateItems, setEstimateItems] = useState<EstimateItem[]>([]);
  const [selectedPartId, setSelectedPartId] = useState('');
  const [selectedPartQuantity, setSelectedPartQuantity] = useState(1);
  const [partError, setPartError] = useState('');
  const [message, setMessage] = useState('');

  const handleWorkOrderPrefill = useCallback(
    (prefill: WorkOrderPrefill) => {
      setActiveTab('estimates');
      setEstimateForm((current) => ({
        ...current,
        customerId: prefill.customerId,
        vehicleId: prefill.vehicleId,
        service: prefill.service,
      }));
      router.replace('/werkstatt', { scroll: false });
    },
    [router],
  );

  const jobs = workOrders.filter((job) => (
    job.status === 'approved' || job.status === 'in_progress' || job.status === 'completed'
  ));
  const estimates = workOrders.filter((job) => job.status === 'draft' || job.status === 'estimate');
  const activeInspection = inspections.find((inspection) => inspection.id === selectedInspection) ?? inspections[0];

  // Photos are not part of the list: fetch those of the open inspection when it is shown.
  useEffect(() => {
    if (activeTab !== 'inspection' || !activeInspection) return;
    for (const item of activeInspection.items) {
      if (item.hasPhoto) void loadInspectionPhoto(item.id);
    }
  }, [activeTab, activeInspection, loadInspectionPhoto]);

  const totalHours = jobs
    .filter((job) => job.status === 'approved' || job.status === 'in_progress')
    .flatMap((job) => job.lines)
    .filter((line) => line.kind === 'labor')
    .reduce((sum, line) => sum + line.quantity, 0);
  const workshopLoad = Math.min(100, Math.round((totalHours / (workstations.length * 8)) * 100));
  const mechanicLoad = useMemo(
    () => mechanicNames.map((mechanic) => ({
      name: mechanic,
      percent: Math.min(100, Math.round((jobs
        .filter((job) => job.mechanic === mechanic && (job.status === 'approved' || job.status === 'in_progress'))
        .flatMap((job) => job.lines)
        .filter((line) => line.kind === 'labor')
        .reduce((sum, line) => sum + line.quantity, 0) / 8) * 100)),
    })),
    [jobs, mechanicNames],
  );

  const updateJob = (job: WorkOrder, changes: Pick<WorkOrder, 'workstation' | 'mechanic'>) => {
    void updateAssignment(job.id, changes);
  };

  const selectedCustomer = customers.find((customer) => customer.id === estimateForm.customerId);
  const customerVehicles = vehicles.filter((vehicle) => vehicle.customerId === estimateForm.customerId);
  const selectedStockPart = stockParts.find((part) => part.id === selectedPartId);
  const addCatalogPart = () => {
    const part = stockParts.find((entry) => entry.id === selectedPartId);
    if (!part || !Number.isFinite(selectedPartQuantity) || selectedPartQuantity <= 0) {
      setPartError('Bitte wähle ein Ersatzteil und eine gültige Menge aus.');
      return;
    }
    setPartError('');
    setEstimateItems((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        partNumber: part.sku,
        manufacturer: '',
        description: part.name,
        quantity: selectedPartQuantity,
        unitNetPrice: part.salePriceCents / 100,
        taxRate: 0.19,
        inventoryPartId: part.id,
        purchasePriceCents: canViewCosts ? part.purchasePriceCents : null,
      },
    ]);
  };
  const estimatePreviewLines = [
    {
      kind: 'labor' as const,
      description: estimateForm.service,
      quantity: estimateForm.hours,
      unitPrice: hourlyRate,
      taxRateBp: 1_900,
      discountBp: 0,
      partId: null,
      purchasePriceCents: null,
    },
    ...(estimateForm.parts > 0 ? [{
      kind: 'part' as const,
      description: 'Sonstiges Material',
      quantity: 1,
      unitPrice: estimateForm.parts,
      taxRateBp: 1_900,
      discountBp: 0,
      partId: null,
      purchasePriceCents: null,
    }] : []),
    ...estimateItems.map((item) => ({
      kind: 'part' as const,
      description: `${[item.manufacturer, item.partNumber].filter(Boolean).join(' ')} · ${item.description}`,
      quantity: item.quantity,
      unitPrice: item.unitNetPrice,
      taxRateBp: 1_900,
      discountBp: 0,
      partId: item.inventoryPartId ?? null,
      purchasePriceCents: item.purchasePriceCents ?? null,
    })),
  ];
  const estimatePreviewTotals = workOrderTotals(estimatePreviewLines.map((line) => ({
    ...line,
    qtyMilli: Math.round(line.quantity * 1_000),
    unitPriceCents: Math.round(line.unitPrice * 100),
  })));

  const handlePhoto = async (event: ChangeEvent<HTMLInputElement>, inspectionId: string, itemId: string) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPhotoError('');
    try {
      const photo = await compressPhoto(file);
      await saveInspectionPhoto(inspectionId, itemId, photo);
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'Das Bild konnte nicht verarbeitet werden.');
    }
  };

  const addInspection = async () => {
    const id = await createInspection();
    if (id) setSelectedInspection(id);
  };

  const saveEstimate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    if (!selectedCustomer || !customerVehicles.some((vehicle) => vehicle.id === estimateForm.vehicleId)) {
      setMessage('Bitte wähle einen Kunden und ein zugehöriges Fahrzeug aus.');
      return;
    }

    const workOrder = await addWorkOrder({
      customerId: selectedCustomer.id,
      vehicleId: estimateForm.vehicleId,
      description: estimateForm.service.trim(),
      workstation: workstations[0],
      mechanic: UNASSIGNED_MECHANIC,
      lines: estimatePreviewLines.map((line) => ({
        kind: line.kind,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxRateBp: line.taxRateBp,
        discountBp: line.discountBp,
        partId: line.partId,
      })),
    });
    if (!workOrder) return;

    setEstimateForm({ customerId: '', vehicleId: '', service: '', hours: 1, parts: 0 });
    setEstimateItems([]);
    setMessage(`Kostenvoranschlag ${workOrder.number} wurde gespeichert.`);
  };

  const advanceEstimate = async (estimate: WorkOrder) => {
    const nextStatus = getAllowedWorkOrderTransitions(estimate.status)[0];
    if (!nextStatus) return;
    const updated = await setWorkOrderStatus(estimate.id, nextStatus);
    if (updated) setMessage(`Auftrag ${estimate.number}: ${workOrderStatusNames[nextStatus]}.`);
  };

  const makeApprovalLink = async (estimate: WorkOrder) => {
    const created = await createLink(estimate.id);
    if (!created) return;
    setShareLinks((current) => ({
      ...current,
      [estimate.id]: { url: buildApprovalUrl(window.location.origin, created.token), expiresAt: created.expiresAt },
    }));
  };

  const copyApprovalLink = async (estimateId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedFor(estimateId);
      window.setTimeout(() => setCopiedFor((current) => (current === estimateId ? '' : current)), 2_000);
    } catch {
      setMessage('Der Link konnte nicht kopiert werden. Bitte markiere ihn und kopiere ihn von Hand.');
    }
  };

  /** What happened with the customer link of this work order, as one coloured line (or nothing). */
  const approvalNote = (job: WorkOrder) => {
    const approval = pickRelevantApproval(approvals, job.id, new Date());
    if (!approval) return null;
    const { tone, label } = describeApprovalForStaff(approval, job.status, new Date());
    return <p className={`mt-2 rounded-xl px-3 py-2 text-xs font-medium ${approvalToneStyles[tone]}`}>{label}</p>;
  };

  const progressWorkOrder = async (job: WorkOrder) => {
    const nextStatus = getAllowedWorkOrderTransitions(job.status)[0];
    if (!nextStatus || nextStatus === 'invoiced') return;
    const updated = await setWorkOrderStatus(job.id, nextStatus);
    if (updated) setMessage(`Auftrag ${job.number}: ${workOrderStatusNames[nextStatus]}.`);
  };

  const createInvoice = async (job: WorkOrder) => {
    const created = await createInvoiceFromWorkOrder(job.id);
    if (created) setMessage(`Rechnungsentwurf für Auftrag ${job.number} wurde erstellt.`);
  };

  const tabs: { id: WorkshopTab; label: string; icon: typeof Gauge }[] = [
    { id: 'board', label: 'Werkstattboard', icon: Gauge },
    { id: 'inspection', label: 'Fahrzeugprüfung', icon: ClipboardCheck },
    { id: 'estimates', label: 'Kalkulation & Angebote', icon: Wrench },
  ];

  return (
    <div className="min-h-screen bg-slate-100 md:h-screen md:overflow-hidden">
      <div className="flex flex-col md:h-full md:flex-row">
        <Suspense fallback={null}>
          <WorkOrderPrefillWatcher onPrefill={handleWorkOrderPrefill} />
        </Suspense>
        <Sidebar />
        <main className="wp-stagger min-w-0 flex-1 bg-slate-50 px-4 py-6 md:h-full md:overflow-y-auto lg:px-10 lg:py-8">
          <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Werkstatt & Betrieb</p>
              <h1 className="mt-2 text-3xl font-medium tracking-tight text-slate-900">Werkstattsteuerung</h1>
              <p className="mt-1 text-sm text-slate-500">Arbeitsplätze, Fahrzeugprüfungen und Kostenvoranschläge zentral verwalten</p>
            </div>
            {activeTab === 'inspection' && (
              <button type="button" onClick={() => void addInspection()} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800">
                <Plus className="h-4 w-4" /> Prüfung anlegen
              </button>
            )}
          </header>

          <nav className="mt-6 flex gap-2 overflow-x-auto rounded-2xl bg-slate-200/70 p-1" aria-label="Werkstattbereiche">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => setActiveTab(id)} aria-current={activeTab === id ? 'page' : undefined}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ${activeTab === id ? 'bg-white text-accent-700 shadow-sm' : 'text-slate-600 hover:bg-white/60'}`}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </nav>

          {inspectionsError && (
            <p role="alert" className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{inspectionsError}</p>
          )}
          {inspectionsNotice && (
            <p role="status" className="mt-4 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800">{inspectionsNotice}</p>
          )}
          {settingsWarning && <p role="alert" className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">{settingsWarning}</p>}
          {(workOrdersError || customerDataError || stockPartsError || approvalsError) && (
            <p role="alert" className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">
              {workOrdersError ?? customerDataError ?? stockPartsError ?? approvalsError}
            </p>
          )}
          {message && <p role="status" className="mt-4 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}

          {activeTab === 'board' && (
            <div className="mt-6 space-y-6">
              <section className="grid gap-4 lg:grid-cols-[1.2fr_2fr]">
                <article className="rounded-3xl bg-slate-900 p-5 text-white shadow-sm">
                  <div className="flex items-center justify-between">
                    <div><p className="text-sm text-slate-300">Auslastung durch offene Aufträge</p><p className="mt-2 text-4xl font-medium">{workshopLoad}%</p></div>
                    <Gauge className="h-9 w-9 text-accent-500" />
                  </div>
                  <div className="mt-5 h-2 rounded-full bg-slate-700"><div className="h-2 rounded-full bg-accent-500" style={{ width: `${workshopLoad}%` }} /></div>
                  <p className="mt-2 text-xs text-slate-400">{totalHours.toLocaleString('de-DE')} von {workstations.length * 8} verfügbaren Arbeitsstunden verplant</p>
                </article>
                <article className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                  <h2 className="font-medium text-slate-900">Auslastung nach Mitarbeitenden</h2>
                  {mechanicLoad.length === 0 && (
                    <p className="mt-4 text-sm text-slate-500">
                      Noch keine Mechaniker angelegt. <Link href="/einstellungen/mitarbeiter" className="font-medium text-accent-700 hover:underline">Mitarbeiter anlegen</Link>
                    </p>
                  )}
                  <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    {mechanicLoad.map(({ name, percent }) => <div key={name}>
                      <div className="flex justify-between gap-2 text-sm"><span className="truncate text-slate-600">{name}</span><span className="font-medium text-slate-900">{percent}%</span></div>
                      <div className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${percent}%` }} /></div>
                    </div>)}
                  </div>
                </article>
              </section>
              {!workOrdersLoaded ? <p className="rounded-3xl bg-white p-8 text-center text-sm text-slate-500">Werkstattaufträge werden geladen …</p> : (
                <section className="grid items-start gap-4 xl:grid-cols-3">
                  {workstations.map((workstation) => {
                    const laneJobs = jobs.filter((job) => job.workstation === workstation);
                    const laneHours = laneJobs
                      .filter((job) => job.status === 'approved' || job.status === 'in_progress')
                      .flatMap((job) => job.lines)
                      .filter((line) => line.kind === 'labor')
                      .reduce((sum, line) => sum + line.quantity, 0);
                    return <article key={workstation} className="rounded-3xl bg-slate-100 p-4 ring-1 ring-slate-200">
                      <div className="mb-4 flex items-center justify-between">
                        <div><h2 className="font-medium text-slate-900">{workstation}</h2><p className="text-xs text-slate-500">{laneJobs.length} Aufträge · {Math.round(Math.min(100, laneHours / 8 * 100))}% belegt</p></div>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600">{laneHours} Std.</span>
                      </div>
                      <div className="space-y-3">
                        {laneJobs.map((job) => {
                          const hours = job.lines
                            .filter((line) => line.kind === 'labor')
                            .reduce((sum, line) => sum + line.quantity, 0);
                          const totals = workOrderTotals(job.lines.map((line) => ({
                            kind: line.kind,
                            qtyMilli: Math.round(line.quantity * 1_000),
                            unitPriceCents: Math.round(line.unitPrice * 100),
                            taxRateBp: line.taxRateBp,
                            discountBp: line.discountBp,
                            purchasePriceCents: line.purchasePriceCents,
                          })));
                          const nextStatus = getAllowedWorkOrderTransitions(job.status)[0];
                          return <div key={job.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-medium text-accent-700">{job.number}</p>
                            <span className={`rounded-full px-2 py-1 text-xs font-medium ${workOrderStatusStyles[job.status]}`}>{workOrderStatusNames[job.status]}</span>
                          </div>
                          <h3 className="mt-2 font-medium text-slate-900">{job.description}</h3>
                          <p className="mt-1 text-sm text-slate-600">{job.customer} · {job.vehicle}</p>
                          <p className="text-xs text-slate-400">{job.plate} · {hours.toLocaleString('de-DE')} Std.</p>
                          <p className="mt-2 text-xs text-slate-500">Arbeit {formatEuro(totals.labor.grossCents)} · Material {formatEuro(totals.part.grossCents)}</p>
                          {approvalNote(job)}
                          {canViewCosts && job.lines.some((line) => line.purchasePriceCents !== null) && (
                            <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                              {job.lines.filter((line) => line.purchasePriceCents !== null).map((line) => (
                                <li key={line.id}>{line.description}{lineMarginLabel(line)}</li>
                              ))}
                            </ul>
                          )}
                          {canViewCosts && job.lines.some((line) => line.purchasePriceCents !== null) && <p className="mt-1 text-xs font-medium text-emerald-700">Marge der Lagerteile: {formatEuro(totals.marginCents)}</p>}
                          <label className="mt-3 block text-xs font-medium text-slate-500">Arbeitsplatz
                            <select value={job.workstation} onChange={(event) => updateJob(job, { workstation: event.target.value, mechanic: job.mechanic })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700">
                              {workstations.map((option) => <option key={option}>{option}</option>)}
                            </select>
                          </label>
                          <label className="mt-2 block text-xs font-medium text-slate-500">Zuständiger Mechaniker
                            <select value={job.mechanic} onChange={(event) => updateJob(job, { workstation: job.workstation, mechanic: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700">
                              {mechanicOptions(mechanicNames, job.mechanic).map((option) => <option key={option}>{option}</option>)}
                            </select>
                          </label>
                          {nextStatus && nextStatus !== 'invoiced' && (
                            <button type="button" onClick={() => void progressWorkOrder(job)} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800">
                              <ArrowRight className="h-3.5 w-3.5" />
                              {nextStatus === 'in_progress' ? 'Arbeit beginnen' : 'Auftrag abschließen'}
                            </button>
                          )}
                          {job.status === 'completed' && canCreateInvoice && (
                            <button type="button" onClick={() => void createInvoice(job)} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500">
                              <ReceiptText className="h-3.5 w-3.5" />
                              Rechnung erstellen
                            </button>
                          )}
                        </div>;
                        })}
                        {laneJobs.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-400">Noch keine Aufträge</p>}
                      </div>
                    </article>;
                  })}
                </section>
              )}
            </div>
          )}

          {activeTab === 'inspection' && (
            <div className="mt-6 grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
              <aside className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <h2 className="px-2 font-medium text-slate-900">Fahrzeugprüfungen</h2>
                <div className="mt-3 space-y-2">
                  {inspections.map((inspection) => <button key={inspection.id} type="button" onClick={() => setSelectedInspection(inspection.id)} className={`w-full rounded-2xl p-3 text-left ${activeInspection?.id === inspection.id ? 'bg-slate-100 ring-1 ring-slate-300' : 'hover:bg-slate-50'}`}>
                    <span className="block font-medium text-slate-900">{inspection.plate || 'Ohne Kennzeichen'}</span><span className="mt-1 block text-xs text-slate-500">{inspection.customerName} · {inspection.vehicleLabel}</span>
                  </button>)}
                  {!inspectionsLoaded && <p className="p-3 text-sm text-slate-500">Prüfungen werden geladen …</p>}
                  {inspectionsLoaded && inspections.length === 0 && <p className="p-3 text-sm text-slate-500">Noch keine Prüfung angelegt.</p>}
                </div>
              </aside>
              <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                {activeInspection ? <>
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                    <div className="grid flex-1 gap-3 sm:grid-cols-3">
                      <label className="text-xs font-medium text-slate-500">Kunde<input value={activeInspection.customerName} maxLength={200} onChange={(event) => updateInspectionHeader(activeInspection.id, { customerName: event.target.value })} placeholder="Kundenname" className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm text-slate-800" /></label>
                      <label className="text-xs font-medium text-slate-500">Fahrzeug<input value={activeInspection.vehicleLabel} maxLength={200} onChange={(event) => updateInspectionHeader(activeInspection.id, { vehicleLabel: event.target.value })} placeholder="Modell" className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm text-slate-800" /></label>
                      <label className="text-xs font-medium text-slate-500">Kennzeichen<input value={activeInspection.plate} maxLength={20} onChange={(event) => updateInspectionHeader(activeInspection.id, { plate: event.target.value })} placeholder="Kennzeichen" className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm text-slate-800" /></label>
                    </div>
                    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700"><Check className="h-3.5 w-3.5" />Prüfung wird in der Datenbank gespeichert</span>
                  </div>
                  {photoError && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{photoError}</p>}
                  <div className="mt-4 space-y-4">
                    {activeInspection.items.map((item) => <article key={item.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="font-medium text-slate-900">{item.label}</h3>
                        <div className="flex flex-wrap gap-2">
                          {INSPECTION_STATUSES.map((status) => <button key={status} type="button" aria-pressed={item.status === status} onClick={() => void setInspectionItemStatus(activeInspection.id, item.id, status)} className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 ${item.status === status ? statusStyles[status] : 'bg-white text-slate-500 ring-slate-200'}`}>{statusNames[status]}</button>)}
                        </div>
                      </div>
                      <textarea aria-label={`Notiz: ${item.label}`} value={item.note} onChange={(event) => setInspectionItemNote(activeInspection.id, item.id, event.target.value)} maxLength={2000} rows={2} placeholder="Befund und Empfehlung des Meisters" className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-accent-600" />
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><Camera className="h-4 w-4" />Foto hinzufügen<input className="sr-only" type="file" accept="image/*" onChange={(event) => void handlePhoto(event, activeInspection.id, item.id)} /></label>
                        {item.hasPhoto && (inspectionPhotos[item.id]
                          ? <img src={inspectionPhotos[item.id]} alt={`Prüffoto: ${item.label}`} className="h-16 w-16 rounded-xl object-cover ring-1 ring-slate-200" />
                          : <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-slate-100 text-[11px] text-slate-400 ring-1 ring-slate-200">lädt …</span>)}
                        {item.hasPhoto && <button type="button" onClick={() => void removeInspectionPhoto(activeInspection.id, item.id)} className="text-xs font-medium text-rose-700 hover:underline">Foto entfernen</button>}
                      </div>
                    </article>)}
                  </div>
                </> : <p className="py-12 text-center text-sm text-slate-500">Lege eine Fahrzeugprüfung an, um Befunde zu dokumentieren.</p>}
              </section>
            </div>
          )}

          {activeTab === 'estimates' && (
            <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <form onSubmit={saveEstimate} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <h2 className="text-xl font-medium text-slate-900">Kostenvoranschlag erstellen</h2>
                <p className="mt-1 text-sm text-slate-500">Arbeitszeit und Material transparent kalkulieren</p>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-medium text-slate-700">Kunde
                    <select required disabled={!customerDataLoaded || customers.length === 0} value={estimateForm.customerId} onChange={(event) => setEstimateForm({ ...estimateForm, customerId: event.target.value, vehicleId: '' })} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 disabled:opacity-60">
                      <option value="">{customerDataLoaded ? 'Kunde auswählen' : 'Kunden werden geladen …'}</option>
                      {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-medium text-slate-700">Fahrzeug
                    <select required disabled={!customerDataLoaded || customerVehicles.length === 0} value={estimateForm.vehicleId} onChange={(event) => setEstimateForm({ ...estimateForm, vehicleId: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 disabled:opacity-60">
                      <option value="">{estimateForm.customerId ? 'Fahrzeug auswählen' : 'Zuerst Kunde auswählen'}</option>
                      {customerVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.make} · {vehicle.plate}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-medium text-slate-700 sm:col-span-2">Arbeitsleistung<input required value={estimateForm.service} onChange={(event) => setEstimateForm({ ...estimateForm, service: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" placeholder="z. B. Bremsbeläge vorn erneuern" /></label>
                  <label className="text-sm font-medium text-slate-700">Arbeitszeit (Stunden)<input required type="number" min="0.25" step="0.25" value={estimateForm.hours} onChange={(event) => setEstimateForm({ ...estimateForm, hours: Number(event.target.value) })} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" /></label>
                  <label className="text-sm font-medium text-slate-700">Sonstiges Material (netto, €)<input required type="number" min="0" step="0.01" value={estimateForm.parts} onChange={(event) => setEstimateForm({ ...estimateForm, parts: Number(event.target.value) })} className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" /></label>
                </div>
                <div className="mt-4 rounded-2xl border border-slate-200 p-4">
                  <h3 className="text-sm font-medium text-slate-900">Ersatzteil aus dem Lagerbestand</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
                    <label className="text-xs font-medium text-slate-600">Artikel
                      <select value={selectedPartId} onChange={(event) => setSelectedPartId(event.target.value)} disabled={!stockPartsLoaded || stockParts.length === 0} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm disabled:opacity-60">
                        <option value="">{stockPartsLoaded ? 'Ersatzteil auswählen' : 'Ersatzteile werden geladen …'}</option>
                        {stockParts.map((part) => <option key={part.id} value={part.id}>{part.sku} · {part.name} · verfügbar {part.availableMilli / 1_000}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-slate-600">Menge
                      <input type="number" min="0.001" step="0.001" value={selectedPartQuantity} onChange={(event) => setSelectedPartQuantity(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm" />
                    </label>
                    <button type="button" onClick={addCatalogPart} disabled={!stockPartsLoaded || !selectedStockPart} className="self-end rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">Hinzufügen</button>
                  </div>
                  {partError && <p role="alert" className="mt-2 text-xs text-rose-700">{partError}</p>}
                </div>
                {estimateItems.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-slate-200 p-4">
                    <h3 className="text-sm font-medium text-slate-900">Ersatzteilpositionen · 19 % MwSt.</h3>
                    <ul className="mt-3 space-y-2">
                      {estimateItems.map((item) => (
                        <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
                          <span className="min-w-0 text-slate-700">{item.manufacturer ? `${item.manufacturer} ` : ''}{item.partNumber} · {item.description} × {item.quantity.toLocaleString('de-DE')}{canViewCosts && item.purchasePriceCents != null ? ` · Marge ${formatEuro(Math.round((item.unitNetPrice * 100 - item.purchasePriceCents) * item.quantity))}` : ''}</span>
                          <span className="flex shrink-0 items-center gap-3 font-medium text-slate-800">
                            {euro.format(item.unitNetPrice * item.quantity)}
                            <button type="button" onClick={() => setEstimateItems((current) => current.filter((entry) => entry.id !== item.id))} className="text-xs font-medium text-rose-700 hover:underline">Entfernen</button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-slate-600">Arbeitsleistung inkl. MwSt.</span><strong className="text-slate-900">{formatEuro(estimatePreviewTotals.labor.grossCents)}</strong></div>
                  <div className="mt-2 flex justify-between gap-3"><span className="text-slate-600">Material inkl. MwSt.</span><strong className="text-slate-900">{formatEuro(estimatePreviewTotals.part.grossCents)}</strong></div>
                  <div className="mt-3 flex justify-between gap-3 border-t border-slate-200 pt-3"><span className="font-medium text-slate-700">Gesamtbetrag inkl. 19 % MwSt.</span><strong className="text-lg text-slate-900">{formatEuro(estimatePreviewTotals.total.grossCents)}</strong></div>
                </div>
                <p className="mt-2 text-xs text-slate-500">Verrechnungssatz: {euro.format(hourlyRate)} je Arbeitsstunde · Steuersatz vorbehaltlich der betrieblichen Einstellung</p>
                <button type="submit" disabled={!workOrdersLoaded || !customerDataLoaded} className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"><Plus className="h-4 w-4" />Angebot speichern</button>
              </form>
              <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <h2 className="text-xl font-medium text-slate-900">Gespeicherte Angebote</h2>
                <div className="mt-4 space-y-3">
                  {!workOrdersLoaded ? <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">Angebote werden geladen …</p> : estimates.length === 0 ? <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">Noch keine Angebote erstellt.</p> : estimates.map((estimate) => {
                    const totals = workOrderTotals(estimate.lines.map((line) => ({
                      kind: line.kind,
                      qtyMilli: Math.round(line.quantity * 1_000),
                      unitPriceCents: Math.round(line.unitPrice * 100),
                      taxRateBp: line.taxRateBp,
                      discountBp: line.discountBp,
                      purchasePriceCents: line.purchasePriceCents,
                    })));
                    return (
                      <article key={estimate.id} className="rounded-2xl border border-slate-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-medium text-slate-900">{estimate.description}</h3>
                            <p className="mt-1 text-sm text-slate-500">{estimate.customer} · {estimate.vehicle} · {estimate.plate}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${workOrderStatusStyles[estimate.status]}`}>
                            {workOrderStatusNames[estimate.status]}
                          </span>
                        </div>
                        <ul className="mt-3 space-y-1 text-xs text-slate-500">
                          {estimate.lines.map((line) => (
                            <li key={line.id}>
                              {line.kind === 'labor' ? 'Arbeit' : 'Material'} · {line.description} · {line.quantity.toLocaleString('de-DE')} × {euro.format(line.unitPrice)} netto
                              {line.discountBp > 0 ? ` · ${line.discountBp / 100} % Rabatt` : ''}
                              {lineMarginLabel(line)}
                            </li>
                          ))}
                        </ul>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium text-slate-800">
                          <span>Arbeit: {formatEuro(totals.labor.grossCents)}</span>
                          <span>Material: {formatEuro(totals.part.grossCents)}</span>
                        </div>
                        {canViewCosts && estimate.lines.some((line) => line.purchasePriceCents !== null) && <p className="mt-1 text-sm font-medium text-emerald-700">Marge der Lagerteile: {formatEuro(totals.marginCents)}</p>}
                        <p className="mt-1 text-sm font-medium text-slate-900">Gesamt: {formatEuro(totals.total.grossCents)}</p>
                        <button
                          type="button"
                          onClick={() => void advanceEstimate(estimate)}
                          disabled={!getAllowedWorkOrderTransitions(estimate.status).length}
                          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-accent-700 hover:bg-slate-200/70 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                          {estimate.status === 'draft' ? 'Angebot erstellen' : 'In Werkstattauftrag übernehmen'}
                        </button>
                        {approvalNote(estimate)}
                        {estimate.status === 'estimate' && (() => {
                          const approval = pickRelevantApproval(approvals, estimate.id, new Date());
                          const isOpen = Boolean(approval && !approval.decision && !approval.revokedAt && new Date(approval.expiresAt).getTime() > Date.now());
                          const share = shareLinks[estimate.id];
                          const customer = customers.find((entry) => entry.id === estimate.customerId);
                          const shareText = share ? buildApprovalShareMessage({ customerName: estimate.customer, workshopName: workshopSettings.companyName, url: share.url }) : '';
                          const whatsappLink = share && customer ? getWhatsAppLink(customer.phone, shareText) : null;
                          return (
                            <div className="mt-3 space-y-2">
                              <div className="flex flex-wrap gap-2">
                                {!approval?.decision && (
                                  <button type="button" onClick={() => void makeApprovalLink(estimate)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
                                    <Link2 className="h-3.5 w-3.5" />
                                    {isOpen ? 'Neuen Freigabe-Link erstellen' : 'Freigabe-Link für Kunden erstellen'}
                                  </button>
                                )}
                                {approval && isOpen && (
                                  <button type="button" onClick={() => void revokeLink(approval.id)} className="rounded-xl px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100">
                                    Link zurückziehen
                                  </button>
                                )}
                              </div>
                              {share && (
                                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                                  <p className="text-xs text-slate-500">Diesen Link an den Kunden senden. Er ist nur jetzt sichtbar und gilt bis {new Date(share.expiresAt).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}.</p>
                                  <input readOnly value={share.url} onFocus={(event) => event.currentTarget.select()} aria-label="Freigabe-Link" className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700" />
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <button type="button" onClick={() => void copyApprovalLink(estimate.id, share.url)} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">
                                      <Copy className="h-3.5 w-3.5" />{copiedFor === estimate.id ? 'Kopiert' : 'Kopieren'}
                                    </button>
                                    {whatsappLink && <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-slate-200 hover:bg-slate-100">WhatsApp</a>}
                                    {customer?.email && <a href={getMailtoLink(customer.email, `Ihr Kostenvoranschlag ${estimate.number}`, shareText)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-accent-700 ring-1 ring-slate-200 hover:bg-slate-100">E-Mail</a>}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </article>
                    );
                  })}
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
