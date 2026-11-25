import { sql } from 'drizzle-orm';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tells the audit-log trigger who is acting. Needed only for privileged operations that run without
 * a user session (issuing and cancelling invoices); normal requests are attributed through auth.uid().
 * The value lives only for the current transaction.
 */
export async function setAuditActor(
  tx: { execute: (query: ReturnType<typeof sql>) => PromiseLike<unknown> },
  actorId: string | undefined,
): Promise<void> {
  if (actorId === undefined) return;
  if (!UUID_PATTERN.test(actorId)) throw new RangeError('actorId must be a valid UUID.');
  await tx.execute(sql`select set_config('app.actor_id', ${actorId}, true)`);
}
