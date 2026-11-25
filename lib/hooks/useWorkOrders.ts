'use client';

import { useCallback, useEffect, useState } from 'react';
import type { WorkOrder, WorkOrderInput, WorkOrderLine } from '../workshop';
import { workOrderStatuses } from '../work-order-status';

type WorkOrderData = {
  workOrders: WorkOrder[];
  canCreateInvoice: boolean;
  canViewCosts: boolean;
  mechanicNames: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWorkOrderLine(value: unknown): value is WorkOrderLine {
  if (!isRecord(value)) return false;
  const purchasePriceCents = value.purchasePriceCents;
  const validPurchasePrice = purchasePriceCents === undefined ||
    purchasePriceCents === null ||
    (typeof purchasePriceCents === 'number' &&
      Number.isSafeInteger(purchasePriceCents) &&
      purchasePriceCents >= 0);
  return (
    typeof value.id === 'string' &&
    typeof value.description === 'string' &&
    (value.kind === 'labor' || value.kind === 'part') &&
    typeof value.quantity === 'number' &&
    Number.isFinite(value.quantity) &&
    value.quantity > 0 &&
    typeof value.unitPrice === 'number' &&
    Number.isFinite(value.unitPrice) &&
    value.unitPrice >= 0 &&
    typeof value.taxRateBp === 'number' &&
    Number.isInteger(value.taxRateBp) &&
    typeof value.discountBp === 'number' &&
    Number.isInteger(value.discountBp) &&
    value.discountBp >= 0 &&
    value.discountBp <= 10_000 &&
    (typeof value.partId === 'string' || value.partId === null) &&
    validPurchasePrice
  );
}

function isWorkOrder(value: unknown): value is WorkOrder {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.number === 'string' &&
    typeof value.customerId === 'string' &&
    typeof value.vehicleId === 'string' &&
    typeof value.customer === 'string' &&
    typeof value.vehicle === 'string' &&
    typeof value.plate === 'string' &&
    typeof value.description === 'string' &&
    typeof value.workstation === 'string' &&
    typeof value.mechanic === 'string' &&
    typeof value.status === 'string' &&
    workOrderStatuses.some((status) => status === value.status) &&
    Array.isArray(value.lines) &&
    value.lines.every(isWorkOrderLine) &&
    typeof value.createdAt === 'string'
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Die Werkstattdaten konnten nicht verarbeitet werden. Bitte versuche es erneut.';
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
      typeof value.error === 'string'
        ? value.error
        : 'Die Anfrage ist fehlgeschlagen. Bitte versuche es erneut.',
    );
  }
  return value;
}

export function useWorkOrders() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [canCreateInvoice, setCanCreateInvoice] = useState(false);
  const [canViewCosts, setCanViewCosts] = useState(false);
  const [mechanicNames, setMechanicNames] = useState<string[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadData = useCallback(async (signal?: AbortSignal): Promise<WorkOrderData> => {
    const response = await fetch('/werkstatt/api', { cache: 'no-store', signal });
    const result = await readApiResponse(response);
    if (
      !Array.isArray(result.workOrders) ||
      !result.workOrders.every(isWorkOrder) ||
      typeof result.canCreateInvoice !== 'boolean' ||
      typeof result.canViewCosts !== 'boolean' ||
      !Array.isArray(result.mechanicNames) ||
      !result.mechanicNames.every((name) => typeof name === 'string')
    ) {
      throw new Error('Die Werkstattdaten haben ein ungültiges Format.');
    }

    const data: WorkOrderData = {
      workOrders: result.workOrders.map((workOrder) => ({
        ...workOrder,
        lines: workOrder.lines.map((line) => ({
          ...line,
          purchasePriceCents: line.purchasePriceCents ?? null,
        })),
      })),
      canCreateInvoice: result.canCreateInvoice,
      canViewCosts: result.canViewCosts,
      mechanicNames: result.mechanicNames as string[],
    };
    setWorkOrders(data.workOrders);
    setCanCreateInvoice(data.canCreateInvoice);
    setCanViewCosts(data.canViewCosts);
    setMechanicNames(data.mechanicNames);
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

  const mutate = useCallback(async (
    action: string,
    body: unknown,
  ): Promise<Record<string, unknown> | null> => {
    setError(null);
    try {
      const response = await fetch(`/werkstatt/api?action=${encodeURIComponent(action)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await readApiResponse(response);
      await reloadData();
      return result;
    } catch (mutationError) {
      setError(errorMessage(mutationError));
      return null;
    }
  }, [reloadData]);

  const addWorkOrder = useCallback(async (input: WorkOrderInput): Promise<WorkOrder | null> => {
    const result = await mutate('createWorkOrder', input);
    if (!result) return null;
    if (!isWorkOrder(result.workOrder)) {
      setError('Der Server hat ungültige Auftragsdaten zurückgegeben.');
      return null;
    }
    return {
      ...result.workOrder,
      lines: result.workOrder.lines.map((line) => ({
        ...line,
        purchasePriceCents: line.purchasePriceCents ?? null,
      })),
    };
  }, [mutate]);

  const setWorkOrderStatus = useCallback(async (id: string, status: WorkOrder['status']): Promise<boolean> => {
    return (await mutate('setWorkOrderStatus', { id, status })) !== null;
  }, [mutate]);

  const updateAssignment = useCallback(async (
    id: string,
    assignment: Pick<WorkOrder, 'workstation' | 'mechanic'>,
  ): Promise<boolean> => {
    return (await mutate('updateWorkOrderAssignment', { id, ...assignment })) !== null;
  }, [mutate]);

  const createInvoiceFromWorkOrder = useCallback(async (id: string): Promise<boolean> => {
    const result = await mutate('createInvoiceFromWorkOrder', { id });
    if (!result) return false;
    if (!isRecord(result.invoice) || typeof result.invoice.id !== 'string') {
      setError('Der Rechnungsentwurf wurde nicht korrekt zurückgegeben.');
      return false;
    }
    return true;
  }, [mutate]);

  return {
    workOrders,
    canCreateInvoice,
    canViewCosts,
    mechanicNames,
    isLoaded,
    error,
    addWorkOrder,
    setWorkOrderStatus,
    updateAssignment,
    createInvoiceFromWorkOrder,
  };
}
