import { describe, expect, it } from 'vitest';
import { isAllowedMechanic, mechanicOptions, UNASSIGNED_MECHANIC } from './workshop';

describe('isAllowedMechanic', () => {
  it('allows unassigned and real staff only', () => {
    expect(isAllowedMechanic(UNASSIGNED_MECHANIC, [])).toBe(true);
    expect(isAllowedMechanic('Anna', ['Anna', 'Ben'])).toBe(true);
    expect(isAllowedMechanic('Jonas Weber', ['Anna'])).toBe(false);
  });
});

describe('mechanicOptions', () => {
  it('starts with unassigned and lists the staff once', () => {
    expect(mechanicOptions(['Anna', 'Anna', 'Ben'])).toEqual([UNASSIGNED_MECHANIC, 'Anna', 'Ben']);
  });

  it('keeps the current value of an older order', () => {
    expect(mechanicOptions(['Anna'], 'Jonas Weber')).toEqual([UNASSIGNED_MECHANIC, 'Anna', 'Jonas Weber']);
    expect(mechanicOptions(['Anna'], 'Anna')).toEqual([UNASSIGNED_MECHANIC, 'Anna']);
  });
});
