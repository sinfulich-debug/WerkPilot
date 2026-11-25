import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applySubscriptionUpdate, tenantForStripeCustomer } from '../../../../lib/db/billing';
import { POST } from './route';

vi.mock('server-only', () => ({}));
vi.mock('../../../../lib/db/billing', () => ({
  applySubscriptionUpdate: vi.fn(),
  tenantForStripeCustomer: vi.fn(),
}));

const SECRET = 'whsec_test_secret';
const TENANT = 'fedcba98-7654-3210-fedc-ba9876543210';
const stripe = new Stripe('sk_test_dummy');

function signed(event: object) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return new Request('http://localhost/api/stripe/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': header } });
}

const subscription = (metadata: Record<string, string> = { tenant_id: TENANT }) => ({
  id: 'sub_1', object: 'subscription', customer: 'cus_1', status: 'active', cancel_at_period_end: false, metadata,
  items: { data: [{ current_period_end: 1_800_000_000 }] },
});

describe('Stripe webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.STRIPE_PRICE_ID = 'price_1';
    vi.mocked(applySubscriptionUpdate).mockResolvedValue(true);
  });
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_PRICE_ID;
  });

  it('is switched off while Stripe is not configured', async () => {
    delete process.env.STRIPE_PRICE_ID;
    expect((await POST(signed({ id: 'evt_1' }))).status).toBe(404);
  });

  it('refuses a missing or wrong signature and stores nothing', async () => {
    const unsigned = new Request('http://localhost/api/stripe/webhook', { method: 'POST', body: '{}' });
    expect((await POST(unsigned)).status).toBe(400);
    const forged = new Request('http://localhost/api/stripe/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=abc' } });
    expect((await POST(forged)).status).toBe(400);
    expect(applySubscriptionUpdate).not.toHaveBeenCalled();
  });

  it('stores a subscription update for the workshop in its metadata, with the event time', async () => {
    const response = await POST(signed({ id: 'evt_1', object: 'event', type: 'customer.subscription.updated', created: 1_790_000_000, data: { object: subscription() } }));
    expect(response.status).toBe(200);
    expect(applySubscriptionUpdate).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ customerId: 'cus_1', status: 'active', periodEnd: new Date(1_800_000_000_000) }),
      new Date(1_790_000_000_000),
    );
  });

  it('finds the workshop by the Stripe customer when metadata is missing, ignores unknown customers', async () => {
    vi.mocked(tenantForStripeCustomer).mockResolvedValueOnce(TENANT).mockResolvedValueOnce(null);
    const event = { id: 'evt_2', object: 'event', type: 'customer.subscription.deleted', created: 1_790_000_000, data: { object: subscription({}) } };
    await POST(signed(event));
    expect(applySubscriptionUpdate).toHaveBeenCalledTimes(1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await POST(signed(event))).status).toBe(200);
    warn.mockRestore();
    expect(applySubscriptionUpdate).toHaveBeenCalledTimes(1);
  });

  it('answers 500 so Stripe retries when storing fails', async () => {
    vi.mocked(applySubscriptionUpdate).mockRejectedValue(new Error('db down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await POST(signed({ id: 'evt_3', object: 'event', type: 'customer.subscription.created', created: 1, data: { object: subscription() } }));
    error.mockRestore();
    expect(response.status).toBe(500);
  });

  it('ignores other events', async () => {
    expect((await POST(signed({ id: 'evt_4', object: 'event', type: 'invoice.paid', created: 1, data: { object: {} } }))).status).toBe(200);
    expect(applySubscriptionUpdate).not.toHaveBeenCalled();
  });
});
