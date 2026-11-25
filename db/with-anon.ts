import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import type { UserTransaction } from './with-user';

/**
 * Runs `fn` with the lowest rights there are: the database role "anon" (a visitor without a login).
 * Only for the functions anon may call (lookup_estimate_approval, hit_public_rate_limit). Everything else is refused by
 * the database itself, so a mistake in the calling code cannot read or write a table.
 */
export async function withAnon<T>(fn: (tx: UserTransaction) => Promise<T> | T): Promise<T> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set before using withAnon.');
  }

  const client = postgres(connectionString, { max: 1 });
  const database = drizzle(client, { schema });
  try {
    return await database.transaction(async (tx) => {
      await tx.execute(sql.raw('SET LOCAL ROLE anon'));
      return await fn(tx);
    });
  } finally {
    await client.end();
  }
}
