/**
 * Subscription rules (pure, safe for pages and tests). Stripe keeps the truth about payments; the
 * webhook mirrors it into tenant_billing, and these functions decide what the workshop may do.
 */

export const TRIAL_DAYS = 30;

export type BillingState = {
  trialEndsAt: Date | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  hasStripeCustomer: boolean;
};

/**
 * free:    no billing row (workshop from before self-registration, pilot) -> never locked
 * trial:   trial running, no paid subscription yet
 * active:  paid subscription (or Stripe trial after subscribing)
 * grace:   last payment failed, Stripe retries; app stays open with a warning
 * expired: trial over and no working subscription -> app locked except the subscription page
 */
export type BillingAccess = 'free' | 'trial' | 'active' | 'grace' | 'expired';

export function billingAccess(state: BillingState | null, now: Date): BillingAccess {
  if (!state) return 'free';
  const status = state.subscriptionStatus;
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'past_due') return 'grace';
  if (state.trialEndsAt === null && status === null) return 'free';
  if (state.trialEndsAt !== null && state.trialEndsAt.getTime() > now.getTime()) return 'trial';
  return 'expired';
}

/** Days left in the trial, rounded up (0 when over). */
export function trialDaysLeft(trialEndsAt: Date | null, now: Date): number {
  if (!trialEndsAt) return 0;
  return Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86_400_000));
}

/**
 * When subscribing during the app trial, Stripe should not charge before the trial ends.
 * Stripe needs a trial end at least 48 hours ahead; shorter rests are charged right away.
 */
export function stripeTrialEnd(trialEndsAt: Date | null, now: Date): number | undefined {
  if (!trialEndsAt) return undefined;
  if (trialEndsAt.getTime() - now.getTime() < 48 * 3_600_000) return undefined;
  return Math.floor(trialEndsAt.getTime() / 1000);
}

export type BillingConfig = { secretKey: string; webhookSecret: string; priceId: string };

/** Billing is on only when all three Stripe settings exist; until then nobody is locked out. */
export function billingConfig(env: Record<string, string | undefined>): BillingConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  const priceId = env.STRIPE_PRICE_ID;
  if (!secretKey || !webhookSecret || !priceId) return null;
  return { secretKey, webhookSecret, priceId };
}

/** Pages a locked workshop can still open. */
export function isOpenWhenLocked(path: string): boolean {
  return path === '/abo';
}

export type SubscriptionUpdate = {
  tenantId: string | null;
  customerId: string;
  subscriptionId: string;
  status: string;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

type StripeSubscriptionLike = {
  id: string;
  customer: string | { id: string };
  status: string;
  cancel_at_period_end: boolean;
  metadata?: Record<string, string> | null;
  items?: { data: Array<{ current_period_end?: number | null }> };
};

/** The fields we keep from a Stripe subscription object. */
export function subscriptionUpdate(subscription: StripeSubscriptionLike): SubscriptionUpdate {
  const periodEnds = (subscription.items?.data ?? [])
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === 'number');
  const tenantId = subscription.metadata?.tenant_id;
  return {
    tenantId: typeof tenantId === 'string' && /^[0-9a-f-]{36}$/i.test(tenantId) ? tenantId : null,
    customerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    subscriptionId: subscription.id,
    status: subscription.status,
    periodEnd: periodEnds.length > 0 ? new Date(Math.max(...periodEnds) * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Aktiv',
  trialing: 'Aktiv (Testphase)',
  past_due: 'Zahlung ausstehend',
  unpaid: 'Unbezahlt',
  canceled: 'Gekündigt',
  incomplete: 'Unvollständig',
  incomplete_expired: 'Abgebrochen',
  paused: 'Pausiert',
};

/** 18.12.2026, in Europe/Berlin (not UTC). */
export function formatBerlinDate(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

export function subscriptionStatusLabel(status: string | null): string {
  return status ? STATUS_LABELS[status] ?? status : 'Kein Abo';
}
