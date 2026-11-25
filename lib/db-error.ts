/**
 * Finds the PostgreSQL error code (for example '23P01' or '23505') of a failed query.
 *
 * Drizzle 0.44 wraps the driver error in a DrizzleQueryError and keeps the real one in `cause`,
 * so the code is not on the top-level error. We follow the `cause` chain (bounded) to find it.
 */
export function getDatabaseErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined;
    if ('code' in current && typeof current.code === 'string' && /^[0-9A-Z]{5}$/.test(current.code)) {
      return current.code;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

/** Exclusion constraint violation, e.g. two appointments in the same bay at the same time. */
export const PG_EXCLUSION_VIOLATION = '23P01';
/** Check violation, e.g. removing the last owner of a workshop. */
export const PG_CHECK_VIOLATION = '23514';
/** Unique constraint violation, e.g. a duplicate article number. */
export const PG_UNIQUE_VIOLATION = '23505';
