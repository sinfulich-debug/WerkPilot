'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { stripeTrialEnd } from './billing';
import { getBillingState, getStripeCustomerId } from './db/billing';
import { safeOrigin } from './registration';
import { requireRole } from './requireRole';
import { getBillingConfig, getStripe } from './stripe';
import { createClient } from './supabase/server';

function appOrigin(): string {
  const origin = safeOrigin(process.env.NEXT_PUBLIC_SITE_URL) ?? safeOrigin(headers().get('origin'));
  if (!origin) throw new Error('Die Adresse der App ist unbekannt (NEXT_PUBLIC_SITE_URL setzen).');
  return origin;
}

/** Owner: opens Stripe Checkout for the subscription. Payment methods (SEPA, card) are switched on in the Stripe dashboard. */
export async function startCheckout(): Promise<void> {
  const config = getBillingConfig();
  if (!config) redirect('/abo?error=disabled');
  const context = await requireRole(['owner']);
  const origin = appOrigin();

  const [state, customerId] = await Promise.all([getBillingState(context), getStripeCustomerId(context)]);
  let email: string | undefined;
  if (!customerId) {
    const supabase = await createClient();
    email = (await supabase.auth.getUser()).data.user?.email ?? undefined;
  }

  const session = await getStripe(config).checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: config.priceId, quantity: 1 }],
    client_reference_id: context.tenantId,
    ...(customerId ? { customer: customerId } : { customer_email: email }),
    subscription_data: {
      metadata: { tenant_id: context.tenantId },
      trial_end: stripeTrialEnd(state?.trialEndsAt ?? null, new Date()),
    },
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    locale: 'de',
    success_url: `${origin}/abo?status=success`,
    cancel_url: `${origin}/abo`,
  });
  if (!session.url) throw new Error('Stripe hat keine Checkout-Adresse geliefert.');
  redirect(session.url);
}

/** Owner: opens the Stripe customer portal (change payment method, invoices, cancel). */
export async function openBillingPortal(): Promise<void> {
  const config = getBillingConfig();
  if (!config) redirect('/abo?error=disabled');
  const context = await requireRole(['owner']);
  const customerId = await getStripeCustomerId(context);
  if (!customerId) redirect('/abo');

  const portal = await getStripe(config).billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appOrigin()}/abo`,
    locale: 'de',
  });
  redirect(portal.url);
}
