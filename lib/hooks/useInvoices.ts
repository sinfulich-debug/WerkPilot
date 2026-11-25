'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Invoice, InvoiceInput } from '../finance';
import { isUnitCode } from '../units';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSnapshotField(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isSellerSnapshot(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.companyName === 'string' &&
    ['ownerName', 'street', 'zip', 'city', 'phone', 'email', 'website', 'taxNumber', 'vatId', 'bankName', 'iban', 'bic']
      .every((key) => isSnapshotField(value[key]))
  );
}

function isBuyerSnapshot(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === 'string' &&
    ['vehiclePlate', 'email', 'phone', 'street', 'zip', 'city']
      .every((key) => isSnapshotField(value[key]))
  );
}

function isInvoice(value: unknown): value is Invoice {
  if (!isRecord(value) || !Array.isArray(value.lines)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.customerId === 'string' &&
    (typeof value.vehicleId === 'string' || value.vehicleId === null) &&
    (typeof value.number === 'string' || value.number === null) &&
    typeof value.customer === 'string' &&
    typeof value.plate === 'string' &&
    (value.taxMode === 'standard19' || value.taxMode === 'reduced7' || value.taxMode === 'smallBusiness') &&
    typeof value.serviceDate === 'string' &&
    (typeof value.dueAt === 'string' || value.dueAt === null) &&
    (typeof value.issuedAt === 'string' || value.issuedAt === null) &&
    (value.status === 'draft' || value.status === 'issued' || value.status === 'paid' || value.status === 'cancelled') &&
    typeof value.paidAmount === 'number' &&
    Number.isFinite(value.paidAmount) &&
    isSellerSnapshot(value.sellerSnapshot) &&
    isBuyerSnapshot(value.buyerSnapshot) &&
    value.lines.every((line) => isRecord(line) &&
      typeof line.id === 'string' &&
      typeof line.description === 'string' &&
      typeof line.quantity === 'number' &&
      Number.isFinite(line.quantity) &&
      (line.unit === undefined || isUnitCode(line.unit)) &&
      typeof line.unitPrice === 'number' &&
      Number.isFinite(line.unitPrice))
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Die Rechnungsdaten konnten nicht geladen werden. Bitte versuche es erneut.';
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

export function useInvoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadData = useCallback(async (signal?: AbortSignal): Promise<Invoice[]> => {
    const response = await fetch('/finanzen/api', { cache: 'no-store', signal });
    const result = await readApiResponse(response);
    if (!Array.isArray(result.invoices) || !result.invoices.every(isInvoice)) {
      throw new Error('Die Rechnungsdaten haben ein ungültiges Format.');
    }

    setInvoices(result.invoices);
    setError(null);
    return result.invoices;
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

  /** Sends a change to the server and reloads the list. Returns the result, or the German error message. */
  const send = useCallback(async (
    action: string,
    body: unknown,
  ): Promise<{ result: Record<string, unknown> | null; error: string | null }> => {
    try {
      const response = await fetch(`/finanzen/api?action=${encodeURIComponent(action)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await readApiResponse(response);
      await reloadData();
      return { result, error: null };
    } catch (mutationError) {
      return { result: null, error: errorMessage(mutationError) };
    }
  }, [reloadData]);

  const mutate = useCallback(async (
    action: string,
    body: unknown,
  ): Promise<Record<string, unknown> | null> => {
    setError(null);
    const { result, error: failure } = await send(action, body);
    if (failure) setError(failure);
    return result;
  }, [send]);

  const createInvoice = useCallback(async (input: InvoiceInput): Promise<Invoice | null> => {
    const result = await mutate('createInvoice', input);
    if (!result) return null;
    if (!isInvoice(result.invoice)) {
      setError('Der Server hat ungültige Rechnungsdaten zurückgegeben.');
      return null;
    }
    return result.invoice;
  }, [mutate]);

  const updateInvoice = useCallback(async (
    id: string,
    input: InvoiceInput,
  ): Promise<Invoice | null> => {
    const result = await mutate('updateInvoice', { id, ...input });
    if (!result) return null;
    if (result.invoice === null) return null;
    if (!isInvoice(result.invoice)) {
      setError('Der Server hat ungültige Rechnungsdaten zurückgegeben.');
      return null;
    }
    return result.invoice;
  }, [mutate]);

  const issueInvoice = useCallback(async (id: string): Promise<string | null> => {
    const result = await mutate('issueInvoice', { id });
    if (!result) return null;
    if (typeof result.number !== 'string') {
      setError('Der Server hat keine Rechnungsnummer zurückgegeben.');
      return null;
    }
    return result.number;
  }, [mutate]);

  /** Cancels an issued invoice with a Storno document; returns the number of the Storno. */
  const cancelInvoice = useCallback(async (id: string): Promise<string | null> => {
    const result = await mutate('cancelInvoice', { id });
    if (!result) return null;
    if (typeof result.number !== 'string') {
      setError('Der Server hat keine Nummer für die Stornorechnung zurückgegeben.');
      return null;
    }
    return result.number;
  }, [mutate]);

  const deleteInvoice = useCallback(async (id: string): Promise<boolean> => {
    return (await mutate('deleteInvoice', { id })) !== null;
  }, [mutate]);

  /**
   * Records a payment. Returns null on success, otherwise the German error message, so that the
   * caller can show it right where the user acted instead of at the top of a long page.
   */
  const addPayment = useCallback(async (
    invoiceId: string,
    amount: number,
    paidAt: string,
  ): Promise<string | null> => {
    const { result, error: failure } = await send('addPayment', { invoiceId, amount, paidAt });
    if (failure) return failure;
    const payment = result?.payment;
    if (
      !isRecord(payment) ||
      typeof payment.id !== 'string' ||
      typeof payment.amount !== 'number' ||
      !Number.isFinite(payment.amount)
    ) {
      return 'Der Server hat ungültige Zahlungsdaten zurückgegeben.';
    }
    return null;
  }, [send]);

  return {
    invoices,
    isLoaded,
    error,
    createInvoice,
    updateInvoice,
    issueInvoice,
    cancelInvoice,
    deleteInvoice,
    addPayment,
  };
}
