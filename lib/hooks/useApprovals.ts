'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApprovalDecision, ApprovalSummary } from '../estimate-approval';

const API = '/werkstatt/freigaben/api';

type ApiResult = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDecision(value: unknown): value is ApprovalDecision | null {
  return value === null || value === 'approved' || value === 'declined';
}

function isApprovalSummary(value: unknown): value is ApprovalSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.workOrderId === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.expiresAt === 'string' &&
    isDecision(value.decision) &&
    (value.decidedAt === null || typeof value.decidedAt === 'string') &&
    typeof value.signerName === 'string' &&
    typeof value.decisionNote === 'string' &&
    (value.revokedAt === null || typeof value.revokedAt === 'string')
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
    throw new Error(typeof result.error === 'string' ? result.error : 'Die Freigabe-Links konnten nicht verarbeitet werden.');
  }
  return result;
}

/** Approval links of the workshop: the list, creating a link (the token is only returned here) and revoking one. */
export function useApprovals() {
  const [approvals, setApprovals] = useState<ApprovalSummary[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const response = await fetch(API, { cache: 'no-store', signal });
    const result = await readResponse(response);
    if (!Array.isArray(result.approvals) || !result.approvals.every(isApprovalSummary)) {
      throw new Error('Die Freigabe-Links haben ein ungültiges Format.');
    }
    setApprovals(result.approvals);
    setError(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Die Freigabe-Links konnten nicht geladen werden.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoaded(true);
      });
    return () => controller.abort();
  }, [reload]);

  const post = useCallback(async (action: string, body: unknown): Promise<ApiResult> => {
    const response = await fetch(`${API}?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return readResponse(response);
  }, []);

  /** Creates a link for an estimate. Returns the token (shown once) or null when it failed. */
  const createLink = useCallback(async (workOrderId: string): Promise<{ token: string; expiresAt: string } | null> => {
    setError(null);
    try {
      const result = await post('create', { workOrderId });
      if (typeof result.token !== 'string' || typeof result.expiresAt !== 'string') {
        throw new Error('Der Server hat eine ungültige Antwort gesendet.');
      }
      await reload();
      return { token: result.token, expiresAt: result.expiresAt };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Der Freigabe-Link konnte nicht erstellt werden.');
      return null;
    }
  }, [post, reload]);

  const revokeLink = useCallback(async (id: string): Promise<boolean> => {
    setError(null);
    try {
      await post('revoke', { id });
      await reload();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Der Freigabe-Link konnte nicht zurückgezogen werden.');
      return false;
    }
  }, [post, reload]);

  return { approvals, isLoaded, error, createLink, revokeLink, reload };
}
