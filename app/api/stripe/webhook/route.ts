import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { subscriptionUpdate } from '../../../../lib/billing';
import { applySubscriptionUpdate, tenantForStripeCustomer } from '../../../../lib/db/billing';
import { getBillingConfig, getStripe } from '../../../../lib/stripe';

// Stripe calls this address (no login). Only events with a valid signature are accepted; the
// database part runs as the role billing_webhook, which can only store subscription states.

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
]);

async function store(subscription: Stripe.Subscription, eventAt: Date, tenantHint: string | null): Promise<void> {
  const update = subscriptionUpdate(subscription);
  const tenantId = update.tenantId ?? tenantHint ?? (await tenantForStripeCustomer(update.customerId));
  if (!tenantId) {
    // e.g. a subscription made by hand in the Stripe dashboard without tenant_id metadata
    console.warn('Stripe-Abo ohne zugeordnete Werkstatt ignoriert.', update.subscriptionId);
    return;
  }
  await applySubscriptionUpdate(tenantId, update, eventAt);
}

export async function POST(request: Request) {
  const config = getBillingConfig();
  if (!config) return NextResponse.json({ ok: false }, { status: 404 });

  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ ok: false }, { status: 400 });

  const stripe = getStripe(config);
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await request.text(), signature, config.webhookSecret);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    const eventAt = new Date(event.created * 1000);
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
      if (session.mode === 'subscription' && subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await store(subscription, eventAt, session.client_reference_id);
      }
    } else if (SUBSCRIPTION_EVENTS.has(event.type)) {
      await store(event.data.object as Stripe.Subscription, eventAt, null);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    // 500 makes Stripe retry later
    console.error('Stripe-Ereignis konnte nicht verarbeitet werden.', event.type, error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
