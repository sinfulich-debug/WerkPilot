import { describe, expect, it, vi } from 'vitest';
import { databaseErrorCode } from './registration';

vi.mock('server-only', () => ({}));

describe('databaseErrorCode', () => {
  it('finds the Postgres code directly or inside a wrapped error', () => {
    expect(databaseErrorCode(Object.assign(new Error('x'), { code: '23505' }))).toBe('23505');
    expect(databaseErrorCode(new Error('wrapped', { cause: { code: '42501' } }))).toBe('42501');
    expect(databaseErrorCode(new Error('none'))).toBeUndefined();
    expect(databaseErrorCode(null)).toBeUndefined();
  });
});
