import { describe, expect, it } from 'vitest';
import {
  billingAccess,
  billingConfig,
  formatBerlinDate,
  isOpenWhenLocked,
  stripeTrialEnd,
  subscriptionStatusLabel,
  subscriptionUpdate,
  trialDaysLeft,
  type BillingState,
} from './billing';

const now = new Date('2026-11-19T12:00:00Z');
const state = (patch: Partial<BillingState>): BillingState => ({
  trialEndsAt: null, subscriptionStatus: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, hasStripeCustomer: false, ...patch,
});

describe('billingAccess', () => {
  it('never locks a workshop without billing row or without trial and subscription (pilot)', () => {
    expect(billingAccess(null, now)).toBe('free');
    expect(billingAccess(state({}), now)).toBe('free');
  });
  it('runs the trial, then locks', () => {
    expect(billingAccess(state({ trialEndsAt: new Date('2026-11-20T00:00:00Z') }), now)).toBe('trial');
    expect(billingAccess(state({ trialEndsAt: new Date('2026-11-19T11:59:59Z') }), now)).toBe('expired');
  });
  it('opens with a paid or Stripe-trialing subscription, warns when a payment failed', () => {
    const over = new Date('2026-10-01T00:00:00Z');
    expect(billingAccess(state({ trialEndsAt: over, subscriptionStatus: 'active' }), now)).toBe('active');
    expect(billingAccess(state({ trialEndsAt: over, subscriptionStatus: 'trialing' }), now)).toBe('active');
    expect(billingAccess(state({ trialEndsAt: over, subscriptionStatus: 'past_due' }), now)).toBe('grace');
  });
  it('locks after cancel or unpaid once the trial is over, even for former pilot workshops', () => {
    expect(billingAccess(state({ trialEndsAt: new Date('2026-10-01T00:00:00Z'), subscriptionStatus: 'canceled' }), now)).toBe('expired');
    expect(billingAccess(state({ subscriptionStatus: 'unpaid' }), now)).toBe('expired');
  });
});

describe('trial helpers', () => {
  it('counts days left rounded up', () => {
    expect(trialDaysLeft(new Date('2026-11-21T00:00:00Z'), now)).toBe(2);
    expect(trialDaysLeft(new Date('2026-11-01T00:00:00Z'), now)).toBe(0);
    expect(trialDaysLeft(null, now)).toBe(0);
  });
  it('passes the trial end to Stripe only when at least 48 hours are left', () => {
    const later = new Date('2026-12-01T00:00:00Z');
    expect(stripeTrialEnd(later, now)).toBe(later.getTime() / 1000);
    expect(stripeTrialEnd(new Date('2026-11-20T12:00:00Z'), now)).toBeUndefined();
    expect(stripeTrialEnd(null, now)).toBeUndefined();
  });
});

describe('billingConfig', () => {
  it('is on only with all three settings', () => {
    expect(billingConfig({ STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh' })).toBeNull();
    expect(billingConfig({ STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh', STRIPE_PRICE_ID: 'price' }))
      .toEqual({ secretKey: 'sk', webhookSecret: 'wh', priceId: 'price' });
  });
  it('keeps only the subscription page open when locked', () => {
    expect(isOpenWhenLocked('/abo')).toBe(true);
    expect(isOpenWhenLocked('/finanzen')).toBe(false);
  });
});

describe('subscriptionUpdate', () => {
  it('takes customer, status, latest period end and the tenant from metadata', () => {
    const update = subscriptionUpdate({
      id: 'sub_1', customer: { id: 'cus_1' }, status: 'active', cancel_at_period_end: true,
      metadata: { tenant_id: 'fedcba98-7654-3210-fedc-ba9876543210' },
      items: { data: [{ current_period_end: 1_800_000_000 }, { current_period_end: 1_700_000_000 }] },
    });
    expect(update).toEqual({
      tenantId: 'fedcba98-7654-3210-fedc-ba9876543210', customerId: 'cus_1', subscriptionId: 'sub_1', status: 'active',
      periodEnd: new Date(1_800_000_000_000), cancelAtPeriodEnd: true,
    });
  });
  it('ignores a malformed tenant id and missing items', () => {
    const update = subscriptionUpdate({ id: 'sub_1', customer: 'cus_1', status: 'canceled', cancel_at_period_end: false, metadata: { tenant_id: "x' or 1=1" } });
    expect(update.tenantId).toBeNull();
    expect(update.periodEnd).toBeNull();
  });
});

describe('labels', () => {
  it('formats dates in Berlin time and names statuses in German', () => {
    expect(formatBerlinDate(new Date('2026-12-31T23:30:00Z'))).toBe('01.01.2027');
    expect(subscriptionStatusLabel('past_due')).toBe('Zahlung ausstehend');
    expect(subscriptionStatusLabel(null)).toBe('Kein Abo');
  });
});
