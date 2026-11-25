'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Boxes, ChartNoAxesCombined, PackagePlus, TriangleAlert } from 'lucide-react';
import Sidebar from '../../components/Sidebar';
import { euroToCents, getInvoiceTotals, isInvoiceList, quantityToMilli } from '../../lib/finance';
import { useParts } from '../../lib/hooks/useParts';
import { useWorkOrders } from '../../lib/hooks/useWorkOrders';
import { usePersistentState } from '../../lib/usePersistentState';
import type { WorkshopInvoice } from '../../lib/finance';
import { formatEuro } from '../../lib/money';

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

function nonnegativeStockQuantityToMilli(quantity: number): number {
  return quantity === 0 ? 0 : quantityToMilli(quantity);
}

function signedStockQuantityToMilli(quantity: number): number {
  if (quantity === 0) return 0;
  const sign = quantity < 0 ? -1 : 1;
  return sign * quantityToMilli(Math.abs(quantity));
}

export default function InventoryPage() {
  const { parts, canViewCosts, isLoaded: partsLoaded, error: partsError, addPart, recordMovement, archivePart } = useParts();
  const { workOrders, isLoaded: workOrdersLoaded, error: workOrdersError } = useWorkOrders();
  const invoicesState = usePersistentState<WorkshopInvoice[]>('werkpilot-invoices', [], isInvoiceList);
  const [form, setForm] = useState({ sku: '', name: '', purchasePrice: 0, salePrice: 0, openingStock: 0, minimum: 0 });
  const [movementInputs, setMovementInputs] = useState<Record<string, { quantity: string; reason: 'purchase' | 'correction' }>>({});
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');

  const lowStock = parts.filter((part) => part.availableMilli <= part.minStockMilli);
  const visibleParts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('de-DE');
    return parts.filter((part) => [part.name, part.sku].some((value) => value.toLocaleLowerCase('de-DE').includes(term)));
  }, [search, parts]);
  const invoiceStats = useMemo(() => invoicesState.value.reduce((stats, invoice) => {
    const amount = getInvoiceTotals(invoice.lines, invoice.taxMode).gross;
    stats.revenue += invoice.status === 'bezahlt' ? amount : 0;
    stats.outstanding += invoice.status === 'offen' ? amount : 0;
    return stats;
  }, { revenue: 0, outstanding: 0 }), [invoicesState.value]);
  const mechanicStats = useMemo(() => {
    const hoursByMechanic = new Map<string, number>();
    workOrders
      .filter((order) => order.status === 'approved' || order.status === 'in_progress')
      .forEach((order) => {
        if (order.mechanic === 'Unzugewiesen') return;
        const laborHours = order.lines
          .filter((line) => line.kind === 'labor')
          .reduce((sum, line) => sum + line.quantity, 0);
        hoursByMechanic.set(order.mechanic, (hoursByMechanic.get(order.mechanic) ?? 0) + laborHours);
      });
    return Array.from(hoursByMechanic, ([name, hours]) => ({ name, hours, percent: Math.min(100, Math.round(hours / 8 * 100)) }));
  }, [workOrders]);
  const stockValueCents = parts.reduce((sum, part) => (
    sum + Math.round(part.stockMilli * (part.purchasePriceCents ?? 0) / 1_000)
  ), 0);

  const handleAddPart = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice('');
    try {
      const saved = await addPart({
        sku: form.sku.trim(),
        name: form.name.trim(),
        purchasePriceCents: euroToCents(form.purchasePrice),
        salePriceCents: euroToCents(form.salePrice),
        minStockMilli: nonnegativeStockQuantityToMilli(form.minimum),
      }, nonnegativeStockQuantityToMilli(form.openingStock));
      if (!saved) return;
      setForm({ sku: '', name: '', purchasePrice: 0, salePrice: 0, openingStock: 0, minimum: 0 });
      setNotice('Ersatzteil wurde im Bestand angelegt.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Das Ersatzteil konnte nicht angelegt werden.');
    }
  };

  const submitMovement = async (event: FormEvent<HTMLFormElement>, partId: string) => {
    event.preventDefault();
    const movement = movementInputs[partId];
    const quantity = Number(movement?.quantity);
    if (!Number.isFinite(quantity) || quantity === 0) {
      setNotice('Bitte gib eine von 0 verschiedene Bewegungsmenge ein.');
      return;
    }
    setNotice('');
    try {
      const saved = await recordMovement(partId, signedStockQuantityToMilli(quantity), movement?.reason ?? 'purchase');
      if (saved) {
        setMovementInputs((current) => ({ ...current, [partId]: { quantity: '', reason: 'purchase' } }));
        setNotice('Bestandsbewegung wurde gebucht.');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Die Bestandsbewegung konnte nicht gebucht werden.');
    }
  };

  const handleArchivePart = async (partId: string) => {
    setNotice('');
    const archived = await archivePart(partId);
    if (archived) setNotice('Ersatzteil wurde archiviert.');
  };

  const exportReport = () => {
    const rows = [
      canViewCosts
        ? ['Artikelnummer', 'Bezeichnung', 'Bestand', 'Reserviert', 'Verfügbar', 'Mindestbestand', 'Einkaufspreis', 'Verkaufspreis']
        : ['Artikelnummer', 'Bezeichnung', 'Bestand', 'Reserviert', 'Verfügbar', 'Mindestbestand', 'Verkaufspreis'],
      ...parts.map((part) => [
        part.sku,
        part.name,
        String(part.stockMilli / 1_000),
        String(part.reservedMilli / 1_000),
        String(part.availableMilli / 1_000),
        String(part.minStockMilli / 1_000),
        ...(canViewCosts ? [((part.purchasePriceCents ?? 0) / 100).toFixed(2)] : []),
        (part.salePriceCents / 100).toFixed(2),
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map((field) => `"${field.replace(/"/g, '""')}"`).join(';')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'werkpilot-lagerbestand.csv';
    link.click();
    URL.revokeObjectURL(url);
    setNotice('Bestandsübersicht wurde als CSV exportiert.');
  };

  const persistenceError = partsError ?? workOrdersError ?? invoicesState.storageError;
  const openWorkOrderCount = workOrders.filter((order) => order.status === 'approved' || order.status === 'in_progress').length;

  return (
    <div className="min-h-screen bg-slate-100 md:h-screen md:overflow-hidden">
      <div className="flex flex-col md:h-full md:flex-row">
        <Sidebar />
        <main className="wp-stagger min-w-0 flex-1 bg-slate-50 px-4 py-6 md:h-full md:overflow-y-auto lg:px-10 lg:py-8">
          <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-sm font-medium text-slate-500">Werkzeuge & Integrationen</p><h1 className="mt-2 text-3xl font-medium tracking-tight text-slate-900">Ersatzteile & Berichte</h1><p className="mt-1 text-sm text-slate-500">Lagerbestände im Blick und betriebliche Kennzahlen auf einen Blick</p></div>
            <button type="button" onClick={exportReport} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><ChartNoAxesCombined className="h-4 w-4" />Bestand exportieren</button>
          </header>

          {(notice || persistenceError) && <p role="status" className="mt-4 rounded-2xl bg-slate-100 p-3 text-sm text-slate-800">{notice || persistenceError}</p>}

          <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {canViewCosts && <article className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><p className="text-sm text-slate-500">Lagerwert (Einkauf, netto)</p><p className="mt-2 text-2xl font-medium text-slate-900">{formatEuro(stockValueCents)}</p><p className="mt-1 text-xs text-slate-500">{parts.length} Artikel im Bestand</p></article>}
            <article className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><p className="text-sm text-slate-500">Nachbestellen</p><p className="mt-2 text-2xl font-medium text-amber-700">{lowStock.length} Artikel</p><p className="mt-1 text-xs text-slate-500">Mindestbestand erreicht oder unterschritten</p></article>
            <article className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><p className="text-sm text-slate-500">Bezahlter Umsatz</p><p className="mt-2 text-2xl font-medium text-emerald-700">{euro.format(invoiceStats.revenue)}</p><p className="mt-1 text-xs text-slate-500">Aus lokal gespeicherten Rechnungen</p></article>
            <article className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><p className="text-sm text-slate-500">Offene Rechnungen</p><p className="mt-2 text-2xl font-medium text-accent-700">{euro.format(invoiceStats.outstanding)}</p><p className="mt-1 text-xs text-slate-500">{invoicesState.value.filter((invoice) => invoice.status === 'offen').length} Zahlungseingänge ausstehend</p></article>
          </section>

          <section className="mt-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]">
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Boxes className="h-5 w-5 text-accent-700" /><h2 className="text-xl font-medium text-slate-900">Lagerbestand</h2></div><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Artikel oder Artikelnummer suchen" aria-label="Bestand durchsuchen" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm" /></div>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm"><thead><tr className="border-b border-slate-200 text-slate-500"><th className="px-3 py-3 font-medium">Artikel</th><th className="px-3 py-3 font-medium">Bestand / verfügbar</th><th className="px-3 py-3 font-medium">Mindestbestand</th>{canViewCosts && <th className="px-3 py-3 font-medium">Einkauf / Verkauf</th>}<th className="px-3 py-3 font-medium">Bewegung buchen</th><th className="px-3 py-3"></th></tr></thead><tbody>
                  {!partsLoaded && <tr><td colSpan={canViewCosts ? 6 : 5} className="px-3 py-8 text-center text-slate-500">Ersatzteile werden geladen …</td></tr>}
                  {partsLoaded && visibleParts.map((part) => {
                    const movement = movementInputs[part.id] ?? { quantity: '', reason: 'purchase' as const };
                    const isLow = part.availableMilli <= part.minStockMilli;
                    return (
                      <tr key={part.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-4"><p className="font-medium text-slate-900">{part.name}</p><p className="text-xs text-slate-500">{part.sku}</p></td>
                        <td className="px-3 py-4">
                          <div className="flex items-center gap-2">{isLow && <TriangleAlert className="h-4 w-4 text-amber-600" />}<span className={isLow ? 'font-medium text-amber-700' : 'text-slate-700'}>{part.stockMilli / 1_000} / {part.availableMilli / 1_000}</span></div>
                          <p className="mt-1 text-xs text-slate-400">{part.reservedMilli / 1_000} reserviert</p>
                        </td>
                        <td className="px-3 py-4 text-slate-600">{part.minStockMilli / 1_000}</td>
                        {canViewCosts && <td className="px-3 py-4 text-xs text-slate-600">{euro.format((part.purchasePriceCents ?? 0) / 100)} / {euro.format(part.salePriceCents / 100)}</td>}
                        <td className="px-3 py-4">
                          <form onSubmit={(event) => void submitMovement(event, part.id)} className="flex min-w-[250px] items-center gap-1">
                            <input aria-label={`Bewegungsmenge für ${part.name}`} required type="number" step="0.001" value={movement.quantity} onChange={(event) => setMovementInputs((current) => ({ ...current, [part.id]: { ...movement, quantity: event.target.value } }))} className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
                            <select aria-label={`Bewegungsgrund für ${part.name}`} value={movement.reason} onChange={(event) => setMovementInputs((current) => ({ ...current, [part.id]: { ...movement, reason: event.target.value === 'correction' ? 'correction' : 'purchase' } }))} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs">
                              <option value="purchase">Wareneingang</option>
                              <option value="correction">Korrektur</option>
                            </select>
                            <button type="submit" className="rounded-lg bg-slate-900 px-2 py-1.5 text-xs font-medium text-white hover:bg-slate-800">Buchen</button>
                          </form>
                        </td>
                        <td className="px-3 py-4"><button type="button" onClick={() => void handleArchivePart(part.id)} className="text-xs font-medium text-rose-700 hover:underline">Archivieren</button></td>
                      </tr>
                    );
                  })}
                  {partsLoaded && visibleParts.length === 0 && <tr><td colSpan={canViewCosts ? 6 : 5} className="px-3 py-8 text-center text-slate-500">Keine passenden Artikel gefunden.</td></tr>}
                </tbody></table>
              </div>
            </div>
            <form onSubmit={(event) => void handleAddPart(event)} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center gap-2"><PackagePlus className="h-5 w-5 text-accent-700" /><h2 className="text-lg font-medium text-slate-900">Ersatzteil aufnehmen</h2></div>
              <div className="mt-4 space-y-3">
                <label className="block text-sm font-medium text-slate-700">Artikelnummer<input required value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} placeholder="z. B. BR-100" className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" /></label>
                <label className="block text-sm font-medium text-slate-700">Bezeichnung<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Artikelname" className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" /></label>
                <div className="grid grid-cols-2 gap-2">
                  {canViewCosts && <label className="text-xs font-medium text-slate-600">Einkaufspreis netto (€)<input required type="number" min="0" step="0.01" value={form.purchasePrice} onChange={(event) => setForm({ ...form, purchasePrice: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm" /></label>}
                  <label className="text-xs font-medium text-slate-600">Verkaufspreis netto (€)<input required type="number" min="0" step="0.01" value={form.salePrice} onChange={(event) => setForm({ ...form, salePrice: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm" /></label>
                  <label className="text-xs font-medium text-slate-600">Anfangsbestand<input required type="number" min="0" step="0.001" value={form.openingStock} onChange={(event) => setForm({ ...form, openingStock: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm" /></label>
                  <label className="text-xs font-medium text-slate-600">Mindestbestand<input required type="number" min="0" step="0.001" value={form.minimum} onChange={(event) => setForm({ ...form, minimum: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm" /></label>
                </div>
              </div>
              <button type="submit" disabled={!partsLoaded} className="mt-4 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">Artikel speichern</button>
            </form>
          </section>

          <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center gap-2"><ChartNoAxesCombined className="h-5 w-5 text-accent-700" /><h2 className="text-xl font-medium text-slate-900">Mitarbeiterauslastung</h2></div>
            <p className="mt-1 text-sm text-slate-500">{workOrdersLoaded ? `${openWorkOrderCount} offene Werkstattaufträge` : 'Werkstattaufträge werden geladen …'}, Auslastung auf Basis eines 8-Stunden-Tages</p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">{mechanicStats.map(({ name, hours, percent }) => <article key={name} className="rounded-2xl bg-slate-50 p-4"><div className="flex justify-between gap-2 text-sm"><span className="font-medium text-slate-700">{name}</span><span className="font-medium text-slate-900">{percent}%</span></div><div className="mt-3 h-2 rounded-full bg-slate-200"><div className="h-2 rounded-full bg-slate-900" style={{ width: `${percent}%` }} /></div><p className="mt-2 text-xs text-slate-500">{hours} Stunden eingeplant</p></article>)}</div>
          </section>
          <p className="mt-4 text-xs text-slate-400">Werkstattaufträge werden aus der Datenbank geladen. Lagerbewegungen und Finanzdaten dieses Berichtsbereichs sind noch nicht mit externen Systemen synchronisiert.</p>
        </main>
      </div>
    </div>
  );
}
