'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronRight, Circle, X } from 'lucide-react';
import type { OnboardingStatus } from '../lib/onboarding';

/** First-run checklist on the dashboard. Renders nothing for mechanics, when done, or when hidden. */
export default function OnboardingChecklist() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/onboarding', { cache: 'no-store' })
      .then((response) => response.json() as Promise<{ ok: boolean; status?: OnboardingStatus | null }>)
      .then((data) => {
        if (!cancelled && data.ok && data.status) setStatus(data.status);
      })
      .catch(() => {
        // The checklist is a helper: if it cannot load, the dashboard works without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status?.visible) return null;

  const hide = async () => {
    setHiding(true);
    setError(null);
    try {
      const response = await fetch('/api/onboarding', { method: 'POST' });
      const data = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? 'Die Checkliste konnte nicht ausgeblendet werden.');
      setStatus({ ...status, visible: false });
    } catch (hideError) {
      setError(hideError instanceof Error ? hideError.message : 'Die Checkliste konnte nicht ausgeblendet werden.');
    } finally {
      setHiding(false);
    }
  };

  const progress = Math.round((status.doneCount / status.requiredCount) * 100);

  return (
    <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-300">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">Erste Schritte</p>
          <h2 className="mt-1 text-xl font-medium text-slate-900">WerkPilot einrichten</h2>
          <p className="mt-1 text-sm text-slate-500">
            {status.doneCount} von {status.requiredCount} Schritten erledigt
          </p>
        </div>
        <button
          type="button"
          onClick={hide}
          disabled={hiding}
          className="inline-flex items-center gap-1 rounded-2xl px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
        >
          <X className="h-4 w-4" />
          Ausblenden
        </button>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div className="h-full rounded-full bg-emerald-500 transition" style={{ width: `${progress}%` }} />
      </div>

      <ol className="mt-4 divide-y divide-slate-100">
        {status.steps.map((step) => (
          <li key={step.id}>
            <Link href={step.href} className="group flex items-center gap-3 py-3">
              {step.done ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
              ) : (
                <Circle className="h-5 w-5 shrink-0 text-slate-300" />
              )}
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-medium ${step.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                  {step.title}
                  {step.optional && <span className="ml-2 text-xs font-normal text-slate-400">optional</span>}
                </span>
                <span className="block text-xs text-slate-500">{step.description}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-accent-600" />
            </Link>
          </li>
        ))}
      </ol>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </section>
  );
}
