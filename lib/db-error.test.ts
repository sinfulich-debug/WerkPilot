import { describe, expect, it } from 'vitest';
import { getDatabaseErrorCode, PG_EXCLUSION_VIOLATION, PG_UNIQUE_VIOLATION } from './db-error';

describe('getDatabaseErrorCode', () => {
  it('reads the code from a plain driver error', () => {
    expect(getDatabaseErrorCode({ code: '23505' })).toBe(PG_UNIQUE_VIOLATION);
  });

  it('finds the code inside the cause of a wrapped Drizzle error', () => {
    const driverError = Object.assign(new Error('conflicting key value'), { code: '23P01' });
    const wrapped = new Error('Failed query: insert into "appointments"', { cause: driverError });
    expect(getDatabaseErrorCode(wrapped)).toBe(PG_EXCLUSION_VIOLATION);
  });

  it('follows nested causes but gives up on loops', () => {
    const inner = { code: '40001' };
    expect(getDatabaseErrorCode({ cause: { cause: inner } })).toBe('40001');

    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(getDatabaseErrorCode(loop)).toBeUndefined();
  });

  it('ignores values that are not a Postgres code', () => {
    expect(getDatabaseErrorCode(new Error('boom'))).toBeUndefined();
    expect(getDatabaseErrorCode({ code: 'ECONNRESET' })).toBeUndefined();
    expect(getDatabaseErrorCode({ code: 23505 })).toBeUndefined();
    expect(getDatabaseErrorCode(null)).toBeUndefined();
    expect(getDatabaseErrorCode('23P01')).toBeUndefined();
  });
});
