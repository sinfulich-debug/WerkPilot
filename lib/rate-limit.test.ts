import { describe, expect, it } from 'vitest';
import { APPROVAL_ANSWER_LIMIT, APPROVAL_VIEW_LIMIT, clientAddress, rateLimitBucket } from './rate-limit';

describe('clientAddress', () => {
  it('takes the first x-forwarded-for entry', () => {
    expect(clientAddress(new Headers({ 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1' }))).toBe('203.0.113.7');
  });
  it('falls back to x-real-ip, then to one shared bucket', () => {
    expect(clientAddress(new Headers({ 'x-real-ip': '2001:db8::1' }))).toBe('2001:db8::1');
    expect(clientAddress(new Headers())).toBe('unknown');
  });
  it('cuts absurdly long header values', () => {
    expect(clientAddress(new Headers({ 'x-forwarded-for': 'a'.repeat(500) }))).toHaveLength(100);
  });
});

describe('rateLimitBucket', () => {
  it('is 64 hex characters and does not contain the address', () => {
    const bucket = rateLimitBucket('freigabe-get', '203.0.113.7');
    expect(bucket).toMatch(/^[0-9a-f]{64}$/);
    expect(bucket).not.toContain('203');
  });
  it('is stable for one client and separate per scope and per client', () => {
    expect(rateLimitBucket('s', '1.2.3.4')).toBe(rateLimitBucket('s', '1.2.3.4'));
    expect(rateLimitBucket('a', '1.2.3.4')).not.toBe(rateLimitBucket('b', '1.2.3.4'));
    expect(rateLimitBucket('s', '1.2.3.4')).not.toBe(rateLimitBucket('s', '1.2.3.5'));
  });
});

describe('approval limits', () => {
  it('use different scopes and stay inside what the database function accepts', () => {
    expect(APPROVAL_VIEW_LIMIT.scope).not.toBe(APPROVAL_ANSWER_LIMIT.scope);
    for (const rule of [APPROVAL_VIEW_LIMIT, APPROVAL_ANSWER_LIMIT]) {
      expect(rule.limit).toBeGreaterThanOrEqual(1);
      expect(rule.limit).toBeLessThanOrEqual(10_000);
      expect(rule.windowSeconds).toBeGreaterThanOrEqual(1);
      expect(rule.windowSeconds).toBeLessThanOrEqual(86_400);
    }
  });
});
