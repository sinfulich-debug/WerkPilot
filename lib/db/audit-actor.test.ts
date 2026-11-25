import { describe, expect, it, vi } from 'vitest';
import { setAuditActor } from './audit-actor';

const actor = '01234567-89ab-cdef-0123-456789abcdef';

describe('setAuditActor', () => {
  it('sets the actor for the current transaction only', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    await setAuditActor({ execute }, actor);
    expect(execute).toHaveBeenCalledTimes(1);
    // set_config(..., true) = local to the transaction; the value is a bound parameter, not text in the SQL
    const query = JSON.stringify(execute.mock.calls[0][0]);
    expect(query).toContain('app.actor_id');
    expect(query).toContain('true');
  });

  it('does nothing without an actor', async () => {
    const execute = vi.fn();
    await setAuditActor({ execute }, undefined);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a value that is not a UUID', async () => {
    const execute = vi.fn();
    await expect(setAuditActor({ execute }, "x'); drop table audit_log; --")).rejects.toThrow(RangeError);
    expect(execute).not.toHaveBeenCalled();
  });
});
