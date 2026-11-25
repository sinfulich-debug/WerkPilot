import 'server-only';

import { and, eq, sql } from 'drizzle-orm';
import { tenantBilling } from '../../db/schema';
import { withBillingWebhook } from '../../db/with-billing';
import { withUser } from '../../db/with-user';
import type { BillingState, SubscriptionUpdate } from '../billing';
import type { SessionContext } from '../session';

type BillingRow = typeof tenantBilling.$inferSelect;

function toState(row: BillingRow): BillingState {
  return {
    trialEndsAt: row.trialEndsAt,
    subscriptionStatus: row.subscriptionStatus,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    hasStripeCustomer: row.stripeCustomerId !== null,
  };
}

async function getRow(context: SessionContext): Promise<BillingRow | null> {
  const rows = await withUser(context.userId, context.tenantId, (tx) =>
    tx.select().from(tenantBilling).where(and(eq(tenantBilling.tenantId, context.tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

/** Billing state of the session's workshop; null = no billing row (pilot workshop, never locked). */
export async function getBillingState(context: SessionContext): Promise<BillingState | null> {
  const row = await getRow(context);
  return row ? toState(row) : null;
}

/** The Stripe customer of the session's workshop, if it has subscribed before. */
export async function getStripeCustomerId(context: SessionContext): Promise<string | null> {
  return (await getRow(context))?.stripeCustomerId ?? null;
}

/** Webhook: the workshop that belongs to a Stripe customer. */
export async function tenantForStripeCustomer(customerId: string): Promise<string | null> {
  return withBillingWebhook(async (tx) => {
    const rows = await tx.execute<{ tenant_id: string | null }>(
      sql`select public.billing_tenant_for_customer(${customerId}) as tenant_id`,
    );
    return rows[0]?.tenant_id ?? null;
  });
}

/** Webhook: stores a subscription state. False when a newer event was applied already. */
export async function applySubscriptionUpdate(
  tenantId: string,
  update: SubscriptionUpdate,
  eventAt: Date,
): Promise<boolean> {
  return withBillingWebhook(async (tx) => {
    const rows = await tx.execute<{ applied: boolean }>(sql`select public.apply_stripe_billing(
      ${tenantId}::uuid, ${update.customerId}, ${update.subscriptionId}, ${update.status},
      ${update.periodEnd?.toISOString() ?? null}::timestamptz, ${update.cancelAtPeriodEnd}, ${eventAt.toISOString()}::timestamptz
    ) as applied`);
    return rows[0]?.applied === true;
  });
}
