import 'server-only';

import Stripe from 'stripe';
import { billingConfig, type BillingConfig } from './billing';

let cached: { key: string; client: Stripe } | null = null;

/** Stripe settings, or null while billing is not configured (then nothing is locked or charged). */
export function getBillingConfig(): BillingConfig | null {
  return billingConfig(process.env);
}

/** Server-side Stripe client. The secret key never reaches the browser or the logs. */
export function getStripe(config: BillingConfig): Stripe {
  if (cached?.key !== config.secretKey) {
    cached = { key: config.secretKey, client: new Stripe(config.secretKey, { appInfo: { name: 'WerkPilot' } }) };
  }
  return cached.client;
}
