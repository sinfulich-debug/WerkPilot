import { describe, expect, it } from 'vitest';
import { generateApprovalToken, hashApprovalToken, TOKEN_BYTES } from './estimate-approval-token';

describe('generateApprovalToken', () => {
  it('is 43 url-safe characters (32 bytes)', () => {
    const token = generateApprovalToken();
    expect(TOKEN_BYTES).toBe(32);
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is different every time', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateApprovalToken()));
    expect(tokens.size).toBe(1000);
  });
});

describe('hashApprovalToken', () => {
  it('is the SHA-256 of the token as 64 hex characters (known test value)', () => {
    expect(hashApprovalToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('is stable for one token and different for another', () => {
    const token = generateApprovalToken();
    expect(hashApprovalToken(token)).toBe(hashApprovalToken(token));
    expect(hashApprovalToken(token)).not.toBe(hashApprovalToken(generateApprovalToken()));
    expect(hashApprovalToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApprovalToken(token)).not.toContain(token);
  });
});

