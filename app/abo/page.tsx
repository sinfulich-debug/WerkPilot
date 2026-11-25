import type { Metadata } from 'next';
import Link from 'next/link';
import { billingAccess, formatBerlinDate, subscriptionStatusLabel, trialDaysLeft } from '../../lib/billing';
import { openBillingPortal, startCheckout } from '../../lib/billing-actions';
import { getBillingState } from '../../lib/db/billing';
import { getSessionContext } from '../../lib/session';
import { getBillingConfig } from '../../lib/stripe';

export const metadata: Metadata = { title: 'WerkPilot | Abo' };

type Props = { searchParams: { status?: string; error?: string } };

const button =
  'rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-accent-600/25 focus:ring-offset-2';

export default async function SubscriptionPage({ searchParams }: Props) {
  const context = await getSessionContext();
  const enabled = getBillingConfig() !== null;
  const state = await getBillingState(context);
  const now = new Date();
  const access = billingAccess(state, now);
  const isOwner = context.role === 'owner';

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-lg rounded-3xl bg-white p-8 shadow-soft ring-1 ring-slate-200/80">
        <p className="text-sm font-medium text-slate-500">WerkPilot</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight text-slate-900">Abo</h1>

        {searchParams.status === 'success' && (
          <p role="status" className="mt-5 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800">
            Danke! Dein Abo wird eingerichtet. Es kann einen Moment dauern, bis der neue Status hier erscheint.
          </p>
        )}

        {!enabled || access === 'free' ? (
          <p className="mt-4 text-sm leading-6 text-slate-600">
            Für deine Werkstatt ist derzeit kein Abo nötig.
          </p>
        ) : (
          <>
            <dl className="mt-6 space-y-3 rounded-2xl bg-slate-50 p-5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Status</dt>
                <dd className="font-medium text-slate-900">
                  {access === 'trial' ? `Testphase, noch ${trialDaysLeft(state?.trialEndsAt ?? null, now)} Tage` : subscriptionStatusLabel(state?.subscriptionStatus ?? null)}
                </dd>
              </div>
              {state?.currentPeriodEnd && (access === 'active' || access === 'grace') && (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">{state.cancelAtPeriodEnd ? 'Endet am' : 'Nächste Verlängerung'}</dt>
                  <dd className="font-medium text-slate-900">{formatBerlinDate(state.currentPeriodEnd)}</dd>
                </div>
              )}
            </dl>

            {access === 'expired' && (
              <p role="alert" className="mt-5 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
                Die Testphase ist vorbei. Mit einem Abo kannst du WerkPilot weiter nutzen; deine Daten bleiben erhalten.
              </p>
            )}
            {access === 'grace' && (
              <p role="alert" className="mt-5 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
                Die letzte Zahlung ist fehlgeschlagen. Bitte prüfe die Zahlungsmethode.
              </p>
            )}

            {isOwner ? (
              <div className="mt-6 flex flex-wrap gap-3">
                {access !== 'active' && access !== 'grace' && (
                  <form action={startCheckout}><button className={button} type="submit">Abo abschließen</button></form>
                )}
                {state?.hasStripeCustomer && (
                  <form action={openBillingPortal}>
                    <button className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50" type="submit">
                      Abo und Rechnungen verwalten
                    </button>
                  </form>
                )}
              </div>
            ) : (
              <p className="mt-5 text-sm text-slate-600">Das Abo verwaltet der Inhaber der Werkstatt.</p>
            )}
          </>
        )}

        {access !== 'expired' && (
          <p className="mt-8 text-sm"><Link href="/" className="font-medium text-accent-700 hover:underline">Zurück zum Dashboard</Link></p>
        )}
      </section>
    </main>
  );
}
