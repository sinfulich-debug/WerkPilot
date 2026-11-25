'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, ClipboardCheck, XCircle } from 'lucide-react';
import { parseDecisionInput, type ApprovalDecision, type ApprovalView } from '../../../lib/estimate-approval';
import { discountedUnitPriceCents, formatEuro, lineNetCents } from '../../../lib/money';

type PageState =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; verdict: string; decision: ApprovalDecision | null; message: string | null; view: ApprovalView }
  | { kind: 'done'; decision: ApprovalDecision; view: ApprovalView };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isApprovalView(value: unknown): value is ApprovalView {
  return (
    isRecord(value) &&
    typeof value.workshopName === 'string' &&
    typeof value.orderNumber === 'string' &&
    typeof value.description === 'string' &&
    typeof value.customerName === 'string' &&
    typeof value.vehicle === 'string' &&
    typeof value.plate === 'string' &&
    Array.isArray(value.lines) &&
    Number.isSafeInteger(value.netCents) &&
    Number.isSafeInteger(value.taxCents) &&
    Number.isSafeInteger(value.grossCents) &&
    typeof value.expiresAt === 'string'
  );
}

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeZone: 'Europe/Berlin' });

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">{children}</section>;
}

export default function ApprovalClient({ token }: { token: string }) {
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [signerName, setSignerName] = useState('');
  const [consent, setConsent] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const api = `/freigabe/${encodeURIComponent(token)}/api`;

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(api, { cache: 'no-store', signal });
      if (response.status === 404) {
        setState({ kind: 'notFound' });
        return;
      }
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body) || body.ok !== true || !isApprovalView(body.view) || typeof body.verdict !== 'string') {
        throw new Error(isRecord(body) && typeof body.error === 'string'
          ? body.error
          : 'Die Seite konnte nicht geladen werden. Bitte versuchen Sie es später erneut.');
      }
      setState({
        kind: 'ready',
        verdict: body.verdict,
        decision: body.decision === 'approved' || body.decision === 'declined' ? body.decision : null,
        message: typeof body.message === 'string' ? body.message : null,
        view: body.view,
      });
    } catch (error) {
      if (signal?.aborted) return;
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Die Seite konnte nicht geladen werden.' });
    }
  }, [api]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const answer = async (event: FormEvent | null, decision: ApprovalDecision, view: ApprovalView) => {
    event?.preventDefault();
    setFormError('');
    const input = parseDecisionInput({ decision, signerName, consent, note });
    if (!input.ok) {
      setFormError(input.message);
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, signerName: input.value.signerName, consent, note: input.value.note }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok && isRecord(body) && body.ok === true) {
        setState({ kind: 'done', decision, view });
        return;
      }
      if (response.status === 409) {
        await load(); // shows why the link cannot be used any more
        return;
      }
      setFormError(isRecord(body) && typeof body.error === 'string' ? body.error : 'Ihre Antwort konnte nicht gespeichert werden.');
    } catch {
      setFormError('Ihre Antwort konnte nicht gesendet werden. Bitte prüfen Sie Ihre Internetverbindung.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8">
      <main className="mx-auto max-w-2xl space-y-5">
        {state.kind === 'loading' && <Card><p className="text-sm text-slate-500">Kostenvoranschlag wird geladen …</p></Card>}

        {state.kind === 'notFound' && (
          <Card>
            <h1 className="text-xl font-medium text-slate-900">Dieser Link ist ungültig</h1>
            <p className="mt-2 text-sm text-slate-600">Bitte prüfen Sie den Link oder nehmen Sie Kontakt mit Ihrer Werkstatt auf.</p>
          </Card>
        )}

        {state.kind === 'error' && (
          <Card>
            <p role="alert" className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{state.message}</p>
          </Card>
        )}

        {state.kind === 'done' && (
          <Card>
            <div className="flex items-start gap-3">
              {state.decision === 'approved'
                ? <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
                : <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-slate-500" />}
              <div>
                <h1 className="text-xl font-medium text-slate-900">
                  {state.decision === 'approved' ? 'Vielen Dank, Ihre Freigabe ist eingegangen' : 'Ihre Ablehnung ist eingegangen'}
                </h1>
                <p className="mt-2 text-sm text-slate-600">
                  {state.decision === 'approved'
                    ? `${state.view.workshopName || 'Ihre Werkstatt'} meldet sich bei Ihnen, sobald es losgeht.`
                    : `${state.view.workshopName || 'Ihre Werkstatt'} wurde informiert und meldet sich bei Ihnen.`}
                </p>
              </div>
            </div>
          </Card>
        )}

        {state.kind === 'ready' && (
          <>
            <Card>
              <p className="flex items-center gap-2 text-sm font-medium text-slate-500">
                <ClipboardCheck className="h-4 w-4" /> {state.view.workshopName || 'Kostenvoranschlag'}
              </p>
              <h1 className="mt-2 text-2xl font-medium tracking-tight text-slate-900">Kostenvoranschlag {state.view.orderNumber}</h1>
              <p className="mt-1 text-sm text-slate-600">
                für {state.view.customerName} · {state.view.vehicle} · {state.view.plate}
              </p>
              <p className="mt-3 text-sm text-slate-800">{state.view.description}</p>

              <div className="mt-5 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-[13px] text-slate-500">
                      <th className="py-2 pr-3 font-medium">Position</th>
                      <th className="py-2 pr-3 text-right font-medium">Menge</th>
                      <th className="py-2 pr-3 text-right font-medium">Einzelpreis</th>
                      <th className="py-2 text-right font-medium">Netto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.view.lines.map((line, index) => (
                      <tr key={`${line.description}-${index}`} className="border-b border-slate-100 align-top">
                        <td className="py-2 pr-3 text-slate-800">
                          {line.description}
                          <span className="block text-xs text-slate-400">{line.kind === 'labor' ? 'Arbeit' : 'Material'}{line.discountBp > 0 ? ` · ${line.discountBp / 100} % Rabatt` : ''}</span>
                        </td>
                        <td className="py-2 pr-3 text-right text-slate-600">{(line.qtyMilli / 1000).toLocaleString('de-DE')}</td>
                        <td className="py-2 pr-3 text-right text-slate-600">{formatEuro(line.unitPriceCents)}</td>
                        <td className="py-2 text-right font-medium text-slate-800">{formatEuro(lineNetCents(line.qtyMilli, discountedUnitPriceCents(line.unitPriceCents, line.discountBp)))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <dl className="mt-4 space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Netto</dt><dd className="text-slate-800">{formatEuro(state.view.netCents)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Umsatzsteuer</dt><dd className="text-slate-800">{formatEuro(state.view.taxCents)}</dd></div>
                <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-medium text-slate-900"><dt>Gesamt (brutto)</dt><dd>{formatEuro(state.view.grossCents)}</dd></div>
              </dl>
              {state.verdict === 'open' && (
                <p className="mt-3 text-xs text-slate-400">Dieser Link ist gültig bis {dateFormat.format(new Date(state.view.expiresAt))}.</p>
              )}
            </Card>

            {state.verdict !== 'open' && state.message && (
              <Card>
                <p role="status" className="text-sm text-slate-700">{state.message}</p>
              </Card>
            )}

            {state.verdict === 'open' && (
              <Card>
                <form onSubmit={(event) => void answer(event, 'approved', state.view)} className="space-y-4">
                  <h2 className="text-lg font-medium text-slate-900">Freigabe</h2>
                  <label className="block text-sm font-medium text-slate-700">
                    Ihr Name (als Bestätigung)
                    <input
                      value={signerName}
                      onChange={(event) => setSignerName(event.target.value)}
                      maxLength={120}
                      autoComplete="name"
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-900 outline-none focus:border-accent-600 focus:bg-white"
                    />
                  </label>
                  <label className="flex items-start gap-3 text-sm text-slate-700">
                    <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 h-4 w-4" />
                    <span>Ich stimme diesem Kostenvoranschlag zu und beauftrage die Werkstatt mit den genannten Arbeiten.</span>
                  </label>
                  {formError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{formError}</p>}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    Verbindlich freigeben
                  </button>
                </form>

                <div className="mt-5 border-t border-slate-100 pt-4">
                  {!declining ? (
                    <button type="button" onClick={() => setDeclining(true)} className="text-sm font-medium text-slate-500 hover:text-slate-700 hover:underline">
                      Kostenvoranschlag ablehnen
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <label className="block text-sm font-medium text-slate-700">
                        Möchten Sie uns einen Grund nennen? (freiwillig)
                        <textarea
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          maxLength={500}
                          rows={2}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-accent-600 focus:bg-white"
                        />
                      </label>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => void answer(null, 'declined', state.view)}
                          className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
                        >
                          Ablehnung senden
                        </button>
                        <button type="button" onClick={() => setDeclining(false)} className="text-sm text-slate-500 hover:underline">Abbrechen</button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
