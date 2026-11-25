import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import type { UserTransaction } from './with-user';

/**
 * Runs `fn` as the database role billing_webhook (migration 0030). Only for the Stripe webhook, which
 * has no logged-in user. The role may only execute billing_tenant_for_customer and apply_stripe_billing;
 * every table access is refused by the database itself.
 */
export async function withBillingWebhook<T>(fn: (tx: UserTransaction) => Promise<T> | T): Promise<T> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set before using withBillingWebhook.');
  }

  const client = postgres(connectionString, { max: 1 });
  const database = drizzle(client, { schema });
  try {
    return await database.transaction(async (tx) => {
      await tx.execute(sql.raw('SET LOCAL ROLE billing_webhook'));
      return await fn(tx);
    });
  } finally {
    await client.end();
  }
}
