'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Part, PartInput } from '../parts';

type ApiResult = {
  ok?: unknown;
  error?: unknown;
  parts?: unknown;
  part?: unknown;
  canViewCosts?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPart(value: unknown): value is Part {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.sku === 'string' &&
    typeof value.name === 'string' &&
    (value.purchasePriceCents === undefined ||
      value.purchasePriceCents === null ||
      Number.isSafeInteger(value.purchasePriceCents)) &&
    Number.isSafeInteger(value.salePriceCents) &&
    Number.isSafeInteger(value.minStockMilli) &&
    Number.isSafeInteger(value.stockMilli) &&
    Number.isSafeInteger(value.reservedMilli) &&
    Number.isSafeInteger(value.availableMilli) &&
    (typeof value.archivedAt === 'string' || value.archivedAt === null)
  );
}

async function readResponse(response: Response): Promise<ApiResult> {
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error('Der Server hat eine ungültige Antwort gesendet.');
  }
  if (!isRecord(result)) throw new Error('Der Server hat eine ungültige Antwort gesendet.');
  if (!response.ok || result.ok !== true) {
    throw new Error(
      typeof result.error === 'string'
        ? result.error
        : 'Die Ersatzteildaten konnten nicht verarbeitet werden.',
    );
  }
  return result;
}

export function useParts() {
  const [parts, setParts] = useState<Part[]>([]);
  const [canViewCosts, setCanViewCosts] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const response = await fetch('/bestand/api', { cache: 'no-store', signal });
    const result = await readResponse(response);
    if (!Array.isArray(result.parts) || !result.parts.every(isPart)) {
      throw new Error('Die Ersatzteildaten haben ein ungültiges Format.');
    }
    setParts(result.parts.map((part) => ({
      ...part,
      purchasePriceCents: part.purchasePriceCents ?? null,
    })));
    if (typeof result.canViewCosts !== 'boolean') {
      throw new Error('Die Berechtigungen für Ersatzteildaten haben ein ungültiges Format.');
    }
    setCanViewCosts(result.canViewCosts);
    setError(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal)
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : 'Die Ersatzteildaten konnten nicht geladen werden.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoaded(true);
      });
    return () => controller.abort();
  }, [reload]);

  const mutate = useCallback(async (
    action: string,
    body: unknown,
  ): Promise<ApiResult | null> => {
    setError(null);
    try {
      const response = await fetch(`/bestand/api?action=${encodeURIComponent(action)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await readResponse(response);
      await reload();
      return result;
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Die Ersatzteildaten konnten nicht gespeichert werden.');
      return null;
    }
  }, [reload]);

  const addPart = useCallback(async (input: PartInput, openingStockMilli: number) => (
    mutate('createPart', { ...input, openingStockMilli })
  ), [mutate]);

  const updatePart = useCallback(async (id: string, input: PartInput) => (
    mutate('updatePart', { ...input, id })
  ), [mutate]);

  const recordMovement = useCallback(async (
    partId: string,
    qtyMilli: number,
    reason: 'purchase' | 'correction',
  ) => mutate('recordStockMovement', { partId, qtyMilli, reason }), [mutate]);

  const archivePart = useCallback(async (id: string) => mutate('archivePart', { id }), [mutate]);

  return {
    parts,
    canViewCosts,
    isLoaded,
    error,
    addPart,
    updatePart,
    recordMovement,
    archivePart,
    reload,
  };
}
