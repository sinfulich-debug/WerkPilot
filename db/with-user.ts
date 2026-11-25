import { sql } from 'drizzle-orm';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

export type UserTransaction = PostgresJsTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

type TransactionCallback<T> = (tx: UserTransaction) => Promise<T> | T;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function withUser<T>(userId: string, fn: TransactionCallback<T>): Promise<T>;
export function withUser<T>(
  userId: string,
  tenantId: string,
  fn: TransactionCallback<T>,
): Promise<T>;
export async function withUser<T>(
  userId: string,
  tenantIdOrFn: string | TransactionCallback<T>,
  callback?: TransactionCallback<T>,
): Promise<T> {
  if (!UUID_PATTERN.test(userId)) {
    throw new Error('userId must be a valid UUID.');
  }

  const fn = typeof tenantIdOrFn === 'function' ? tenantIdOrFn : callback;
  if (!fn) {
    throw new Error('A transaction callback is required.');
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL must be set before using withUser.');
  }

  const client = postgres(connectionString, { max: 1 });
  const database = drizzle(client, { schema });
  const claims = JSON.stringify({ sub: userId });

  try {
    return await database.transaction(async (tx) => {
      await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
      await tx.execute(sql.raw('SET LOCAL ROLE authenticated'));
      return await fn(tx);
    });
  } finally {
    await client.end();
  }
}
