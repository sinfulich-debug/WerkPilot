'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Customer, CustomerInput, Vehicle, VehicleInput } from '../customers';
import type { ConsentSource } from '../reminder-consent';

type CustomerData = {
  customers: Customer[];
  vehicles: Vehicle[];
};

type ArchivedCustomerData = {
  archivedCustomers: Customer[];
  archivedVehicles: Vehicle[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCustomer(value: unknown): value is Customer {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.phone === 'string' &&
    typeof value.email === 'string' &&
    (value.notes === undefined || typeof value.notes === 'string') &&
    (value.archivedAt === undefined || typeof value.archivedAt === 'string') &&
    (value.reminderConsentAt === undefined || typeof value.reminderConsentAt === 'string') &&
    (value.reminderConsentSource === undefined || typeof value.reminderConsentSource === 'string') &&
    (value.reminderOptOutAt === undefined || typeof value.reminderOptOutAt === 'string')
  );
}

function isVehicle(value: unknown): value is Vehicle {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.customerId === 'string' &&
    typeof value.make === 'string' &&
    typeof value.plate === 'string' &&
    typeof value.tuvDueDate === 'string' &&
    (value.year === undefined || typeof value.year === 'number') &&
    (value.hsn === undefined || typeof value.hsn === 'string') &&
    (value.tsn === undefined || typeof value.tsn === 'string') &&
    (value.vin === undefined || typeof value.vin === 'string') &&
    (value.engine === undefined || typeof value.engine === 'string') &&
    (value.tuvIntervalMonths === undefined || typeof value.tuvIntervalMonths === 'number') &&
    (value.lastReminderSentAt === undefined || typeof value.lastReminderSentAt === 'string') &&
    (value.archivedAt === undefined || typeof value.archivedAt === 'string')
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Die Anfrage ist fehlgeschlagen. Bitte versuche es erneut.';
}

async function readApiResponse(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error('Der Server hat eine ungültige Antwort gesendet.');
  }

  if (!isRecord(value)) throw new Error('Der Server hat eine ungültige Antwort gesendet.');
  if (!response.ok || value.ok !== true) {
    throw new Error(
      typeof value.error === 'string' ? value.error : 'Die Anfrage ist fehlgeschlagen. Bitte versuche es erneut.',
    );
  }
  return value;
}

export function useCustomers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [archivedCustomers, setArchivedCustomers] = useState<Customer[]>([]);
  const [archivedVehicles, setArchivedVehicles] = useState<Vehicle[]>([]);
  const [archivesLoaded, setArchivesLoaded] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadData = useCallback(async (signal?: AbortSignal): Promise<CustomerData> => {
    const response = await fetch('/kunden/api', { cache: 'no-store', signal });
    const result = await readApiResponse(response);
    if (
      !Array.isArray(result.customers) ||
      !result.customers.every(isCustomer) ||
      !Array.isArray(result.vehicles) ||
      !result.vehicles.every(isVehicle)
    ) {
      throw new Error('Die Kundendaten haben ein ungültiges Format.');
    }

    const data = { customers: result.customers, vehicles: result.vehicles };
    setCustomers(data.customers);
    setVehicles(data.vehicles);
    setError(null);
    return data;
  }, []);

  const reloadArchivedData = useCallback(async (): Promise<ArchivedCustomerData> => {
    const response = await fetch('/kunden/api?archived=true', { cache: 'no-store' });
    const result = await readApiResponse(response);
    if (
      !Array.isArray(result.customers) ||
      !result.customers.every(isCustomer) ||
      !Array.isArray(result.vehicles) ||
      !result.vehicles.every(isVehicle)
    ) {
      throw new Error('Die Archivdaten haben ein ungültiges Format.');
    }

    const data = {
      archivedCustomers: result.customers,
      archivedVehicles: result.vehicles,
    };
    setArchivedCustomers(data.archivedCustomers);
    setArchivedVehicles(data.archivedVehicles);
    setArchivesLoaded(true);
    setError(null);
    return data;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        await reloadData(controller.signal);
      } catch (loadError) {
        if (!controller.signal.aborted) setError(errorMessage(loadError));
      } finally {
        if (!controller.signal.aborted) setIsLoaded(true);
      }
    };

    void load();
    return () => controller.abort();
  }, [reloadData]);

  const mutate = useCallback(async (action: string, body: unknown): Promise<boolean> => {
    setError(null);
    try {
      const response = await fetch(`/kunden/api?action=${encodeURIComponent(action)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await readApiResponse(response);
      await reloadData();
      if (archivesLoaded) await reloadArchivedData();
      return true;
    } catch (mutationError) {
      setError(errorMessage(mutationError));
      return false;
    }
  }, [archivesLoaded, reloadArchivedData, reloadData]);

  const addCustomer = useCallback(
    (input: CustomerInput) => mutate('createCustomer', input),
    [mutate],
  );
  const updateCustomer = useCallback(
    (id: string, input: CustomerInput) => mutate('updateCustomer', { id, ...input }),
    [mutate],
  );
  const deleteCustomer = useCallback(
    (id: string) => mutate('deleteCustomer', { id }),
    [mutate],
  );
  const restoreCustomer = useCallback(
    (id: string) => mutate('restoreCustomer', { id }),
    [mutate],
  );
  const addVehicle = useCallback(
    (input: VehicleInput) => mutate('createVehicle', input),
    [mutate],
  );
  const updateVehicle = useCallback(
    (id: string, input: VehicleInput) => mutate('updateVehicle', { id, ...input }),
    [mutate],
  );
  const deleteVehicle = useCallback(
    (id: string) => mutate('deleteVehicle', { id }),
    [mutate],
  );
  const restoreVehicle = useCallback(
    (id: string) => mutate('restoreVehicle', { id }),
    [mutate],
  );
  const markReminderSent = useCallback(
    (vehicleId: string) => mutate('markReminderSent', { vehicleId }),
    [mutate],
  );

  const recordReminderConsent = useCallback(
    (customerId: string, source: ConsentSource) => mutate('recordReminderConsent', { customerId, source }),
    [mutate],
  );
  const recordReminderOptOut = useCallback(
    (customerId: string) => mutate('recordReminderOptOut', { customerId }),
    [mutate],
  );

  return {
    recordReminderConsent,
    recordReminderOptOut,
    customers,
    vehicles,
    archivedCustomers,
    archivedVehicles,
    archivesLoaded,
    isLoaded,
    error,
    loadArchived: reloadArchivedData,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    restoreCustomer,
    addVehicle,
    updateVehicle,
    deleteVehicle,
    restoreVehicle,
    markReminderSent,
  };
}
