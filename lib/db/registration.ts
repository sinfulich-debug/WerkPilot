import 'server-only';

import { sql } from 'drizzle-orm';
import { withUser } from '../../db/with-user';

/**
 * Creates the workshop of a freshly registered user and makes them its owner, through the database
 * function register_workshop (migration 0029). Runs as the user (role authenticated); the function
 * itself checks: logged in, e-mail confirmed, no workshop yet, valid name.
 */
export async function registerWorkshop(userId: string, workshopName: string): Promise<string> {
  return withUser(userId, async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`select public.register_workshop(${workshopName}) as id`);
    const id = rows[0]?.id;
    if (typeof id !== 'string') throw new Error('Die Werkstatt konnte nicht angelegt werden.');
    return id;
  });
}

/** Postgres error code of a failed call (postgres.js puts it on `code`, Drizzle may wrap it in `cause`). */
export function databaseErrorCode(error: unknown): string | undefined {
  for (let current: unknown = error, depth = 0; current && depth < 3; depth += 1) {
    if (typeof current === 'object' && 'code' in current && typeof current.code === 'string') return current.code;
    current = typeof current === 'object' && 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}
