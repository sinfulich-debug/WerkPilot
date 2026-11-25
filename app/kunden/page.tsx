'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Archive, Mail, Pencil, Phone, Plus, RotateCcw, Search, Upload } from 'lucide-react';
import ConfirmDialog from '../../components/ConfirmDialog';
import CustomerModal from '../../components/CustomerModal';
import Sidebar from '../../components/Sidebar';
import Plate from '../../components/Plate';
import VehicleModal from '../../components/VehicleModal';
import {
  getTuvStatus,
  type Customer,
  type CustomerInput,
  type TuvStatus,
  type Vehicle,
  type VehicleInput,
} from '../../lib/customers';
import { useCustomers } from '../../lib/hooks/useCustomers';

type TuvFilter = 'all' | 'overdue' | 'soon';
type DeleteRequest =
  | { type: 'customer'; id: string; label: string }
  | { type: 'vehicle'; id: string; label: string };

const tuvFilters: { value: TuvFilter; label: string }[] = [
  { value: 'all', label: 'Alle' },
  { value: 'overdue', label: 'TÜV überfällig' },
  { value: 'soon', label: 'TÜV bald fällig (30 Tage)' },
];

function formatDueDate(date: string): string {
  return new Intl.DateTimeFormat('de-DE').format(new Date(`${date}T00:00:00`));
}

function getTuvBadge(status: TuvStatus, daysUntilDue: number): { label: string; className: string } {
  if (status === 'overdue') {
    const days = Math.abs(daysUntilDue);
    return {
      label: `seit ${days} ${days === 1 ? 'Tag' : 'Tagen'}`,
      className: 'bg-rose-100 text-rose-700',
    };
  }
  if (status === 'soon') {
    return {
      label: daysUntilDue === 0 ? 'heute fällig' : `in ${daysUntilDue} ${daysUntilDue === 1 ? 'Tag' : 'Tagen'}`,
      className: 'bg-amber-100 text-amber-700',
    };
  }
  return { label: 'In Ordnung', className: 'bg-emerald-100 text-emerald-700' };
}

export default function CustomersPage() {
  const {
    customers,
    vehicles,
    archivedCustomers,
    archivedVehicles,
    archivesLoaded,
    isLoaded,
    error,
    loadArchived,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    restoreCustomer,
    addVehicle,
    updateVehicle,
    deleteVehicle,
    restoreVehicle,
  } = useCustomers();
  const [search, setSearch] = useState('');
  const [tuvFilter, setTuvFilter] = useState<TuvFilter>('all');
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [vehicleModal, setVehicleModal] = useState<{ customerId: string; vehicle: Vehicle | null } | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [showArchive, setShowArchive] = useState(false);

  const customerCards = useMemo(() => {
    const searchTerm = search.trim().toLocaleLowerCase('de-DE');

    return customers
      .map((customer) => {
        const customerMatchesSearch =
          searchTerm.length === 0 ||
          [customer.name, customer.phone].some((value) => value.toLocaleLowerCase('de-DE').includes(searchTerm));
        const customerVehicles = vehicles
          .filter((vehicle) => vehicle.customerId === customer.id)
          .sort((a, b) => a.tuvDueDate.localeCompare(b.tuvDueDate))
          .filter((vehicle) => {
            const { status } = getTuvStatus(vehicle.tuvDueDate);
            const matchesFilter = tuvFilter === 'all' || status === tuvFilter;
            const matchesVehicleSearch =
              searchTerm.length === 0 ||
              [vehicle.make, vehicle.plate].some((value) => value.toLocaleLowerCase('de-DE').includes(searchTerm));
            return matchesFilter && (customerMatchesSearch || matchesVehicleSearch);
          });
        const shouldShow =
          (customerMatchesSearch && (tuvFilter === 'all' || customerVehicles.length > 0)) || customerVehicles.length > 0;

        return shouldShow ? { customer, vehicles: customerVehicles } : null;
      })
      .filter((card): card is { customer: Customer; vehicles: Vehicle[] } => card !== null);
  }, [customers, vehicles, search, tuvFilter]);

  const openNewCustomerModal = () => {
    setEditingCustomer(null);
    setIsCustomerModalOpen(true);
  };

  const openEditCustomerModal = (customer: Customer) => {
    setEditingCustomer(customer);
    setIsCustomerModalOpen(true);
  };

  const handleSaveCustomer = async (input: CustomerInput) => {
    let saved: boolean;
    if (editingCustomer) {
      saved = await updateCustomer(editingCustomer.id, input);
    } else {
      saved = await addCustomer(input);
    }
    if (!saved) return;

    setIsCustomerModalOpen(false);
    setEditingCustomer(null);
  };

  const handleSaveVehicle = (input: VehicleInput) => {
    if (!vehicleModal) return;
    if (vehicleModal.vehicle) {
      updateVehicle(vehicleModal.vehicle.id, input);
    } else {
      addVehicle(input);
    }
    setVehicleModal(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteRequest) return;
    let archived: boolean;
    if (deleteRequest.type === 'customer') {
      archived = await deleteCustomer(deleteRequest.id);
    } else {
      archived = await deleteVehicle(deleteRequest.id);
    }
    if (archived) setDeleteRequest(null);
  };

  const handleArchiveToggle = async () => {
    const shouldShowArchive = !showArchive;
    setShowArchive(shouldShowArchive);
    if (shouldShowArchive) await loadArchived();
  };

  return (
    <div className="min-h-screen bg-slate-100 md:h-screen md:overflow-hidden">
      <div className="flex flex-col md:h-full md:flex-row">
        <Sidebar />

        <main className="wp-stagger min-w-0 flex-1 bg-slate-50 px-4 py-6 md:h-full md:overflow-y-auto lg:px-10 lg:py-8">
          <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Kundenverwaltung</p>
              <h1 className="mt-2 text-3xl font-medium tracking-tight text-slate-900">Kunden & Fahrzeuge</h1>
              <p className="mt-1 text-sm text-slate-500">Kontaktdaten und TÜV-Fälligkeiten im Überblick</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/kunden/import"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <Upload className="h-4 w-4" />
                CSV-Import
              </Link>
              <button
                type="button"
                onClick={handleArchiveToggle}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <Archive className="h-4 w-4" />
                {showArchive ? 'Archiv ausblenden' : 'Archiv anzeigen'}
              </button>
              <button
                type="button"
                onClick={openNewCustomerModal}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                Neuer Kunde
              </button>
            </div>
          </header>

          <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
              <label className="relative block text-sm font-medium text-slate-700">
                Suche
                <Search className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name, Telefon, Kennzeichen oder Fahrzeug"
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                />
              </label>

              <label className="block text-sm font-medium text-slate-700">
                TÜV-Status
                <select
                  value={tuvFilter}
                  onChange={(event) => setTuvFilter(event.target.value as TuvFilter)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
                >
                  {tuvFilters.map((filter) => (
                    <option key={filter.value} value={filter.value}>
                      {filter.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {error && !isCustomerModalOpen && (
            <p role="alert" className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          )}

          {showArchive && (
            <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-lg font-medium text-slate-900">Archivierte Einträge</h2>
              {!archivesLoaded ? (
                <p className="mt-3 text-sm text-slate-500">Archivierte Einträge werden geladen …</p>
              ) : archivedCustomers.length === 0 && archivedVehicles.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">Das Archiv ist leer.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {archivedCustomers.map((customer) => (
                    <div
                      key={`customer-${customer.id}`}
                      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-medium text-slate-900">{customer.name}</p>
                        <p className="text-sm text-slate-500">Kunde</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => restoreCustomer(customer.id)}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Wiederherstellen
                      </button>
                    </div>
                  ))}
                  {archivedVehicles.map((vehicle) => (
                    <div
                      key={`vehicle-${vehicle.id}`}
                      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-medium text-slate-900">{vehicle.make}</p>
                        <p className="text-sm text-slate-500">
                          {vehicle.plate} · {customers.find((customer) => customer.id === vehicle.customerId)?.name}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => restoreVehicle(vehicle.id)}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Wiederherstellen
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="mt-6 space-y-5">
            {!isLoaded ? (
              <div className="rounded-3xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
                Kunden und Fahrzeuge werden geladen …
              </div>
            ) : customerCards.length === 0 ? (
              <div className="rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
                <h2 className="text-lg font-medium text-slate-900">
                  {customers.length === 0 ? 'Noch keine Kunden vorhanden' : 'Keine Kunden gefunden'}
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  {customers.length === 0
                    ? 'Lege einen neuen Kunden an, um Kontaktdaten und Fahrzeuge zu verwalten.'
                    : 'Passe deine Suche oder den TÜV-Filter an.'}
                </p>
              </div>
            ) : (
              customerCards.map(({ customer, vehicles: customerVehicles }) => (
                <article key={customer.id} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                  <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="text-xl font-medium text-slate-900">{customer.name}</h2>
                      <div className="mt-2 flex flex-col gap-2 text-sm text-slate-500 sm:flex-row sm:flex-wrap sm:gap-4">
                        <span className="inline-flex items-center gap-2">
                          <Phone className="h-4 w-4" />
                          {customer.phone}
                        </span>
                        <span className="inline-flex items-center gap-2 break-all">
                          <Mail className="h-4 w-4 shrink-0" />
                          {customer.email}
                        </span>
                      </div>
                      {customer.notes && <p className="mt-2 text-sm text-slate-500">{customer.notes}</p>}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setVehicleModal({ customerId: customer.id, vehicle: null })}
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-accent-700 hover:bg-slate-200/70"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Fahrzeug hinzufügen
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditCustomerModal(customer)}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Bearbeiten
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteRequest({ type: 'customer', id: customer.id, label: customer.name })
                        }
                        className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50"
                      >
                        <Archive className="h-3.5 w-3.5" />
                        Archivieren
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3">
                    {customerVehicles.length === 0 ? (
                      <p className="rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">
                        Für diesen Kunden sind noch keine passenden Fahrzeuge hinterlegt.
                      </p>
                    ) : (
                      customerVehicles.map((vehicle) => {
                        const { status, daysUntilDue } = getTuvStatus(vehicle.tuvDueDate);
                        const badge = getTuvBadge(status, daysUntilDue);
                        return (
                          <div
                            key={vehicle.id}
                            className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900">{vehicle.make}</p>
                              <Plate value={vehicle.plate} className="mt-1.5" />
                              {(vehicle.year || vehicle.hsn || vehicle.tsn) && (
                                <p className="mt-1 text-xs text-slate-500">
                                  {vehicle.year ? `Baujahr ${vehicle.year}` : ''}
                                  {vehicle.hsn || vehicle.tsn ? ` · HSN/TSN ${vehicle.hsn ?? '–'}/${vehicle.tsn ?? '–'}` : ''}
                                </p>
                              )}
                              {vehicle.vin && <p className="mt-1 break-all font-mono text-xs text-slate-400">FIN: {vehicle.vin}</p>}
                              {vehicle.engine && <p className="mt-1 text-xs text-slate-500">Motorisierung: {vehicle.engine}</p>}
                              {vehicle.tuvIntervalMonths && <p className="mt-1 text-xs text-slate-500">HU-Prüfintervall: {vehicle.tuvIntervalMonths} Monate</p>}
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className="text-xs text-slate-500">TÜV fällig bis {formatDueDate(vehicle.tuvDueDate)}</span>
                                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}>
                                  {badge.label}
                                </span>
                              </div>
                            </div>
                            <div className="flex shrink-0 gap-2">
                              <Link
                                href={`/termine?customerId=${encodeURIComponent(customer.id)}&vehicleId=${encodeURIComponent(vehicle.id)}`}
                                className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-accent-700 hover:bg-slate-200/70"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Termin anlegen
                              </Link>
                              <button
                                type="button"
                                onClick={() => setVehicleModal({ customerId: customer.id, vehicle })}
                                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Bearbeiten
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteRequest({ type: 'vehicle', id: vehicle.id, label: vehicle.make })
                                }
                                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50"
                              >
                                <Archive className="h-3.5 w-3.5" />
                                Archivieren
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </article>
              ))
            )}
          </section>
        </main>
      </div>

      {isCustomerModalOpen && (
        <CustomerModal
          customer={editingCustomer}
          error={error}
          onClose={() => {
            setIsCustomerModalOpen(false);
            setEditingCustomer(null);
          }}
          onSave={handleSaveCustomer}
        />
      )}

      {vehicleModal && (
        <VehicleModal
          customerId={vehicleModal.customerId}
          vehicle={vehicleModal.vehicle}
          onClose={() => setVehicleModal(null)}
          onSave={handleSaveVehicle}
        />
      )}

      {deleteRequest && (
        <ConfirmDialog
          title={deleteRequest.type === 'customer' ? 'Kunden archivieren?' : 'Fahrzeug archivieren?'}
          confirmLabel="Archivieren"
          confirmVariant="primary"
          message={
            deleteRequest.type === 'customer'
              ? `Möchtest du „${deleteRequest.label}“ archivieren? Zugehörige Fahrzeuge werden ebenfalls aus den aktiven Listen ausgeblendet. Rechnungen bleiben erhalten.`
              : `Möchtest du „${deleteRequest.label}“ archivieren? Das Fahrzeug kann später wiederhergestellt werden.`
          }
          onCancel={() => setDeleteRequest(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
}
