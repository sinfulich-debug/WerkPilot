import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL must be set before using the PostgreSQL database client.');
}

const client = postgres(connectionString);

export const db = drizzle(client, { schema });
export type Database = typeof db;

export async function closeDatabase(): Promise<void> {
  await client.end();
}
