import { describe, expect, it } from 'vitest';
import { buildOnboardingStatus, missingStammdaten, type OnboardingFacts } from './onboarding';

const fullProfile = {
  companyName: 'Kfz Müller',
  street: 'Hauptstr. 1',
  zip: '70173',
  city: 'Stuttgart',
  taxNumber: '',
  vatId: 'DE123456789',
};

const fresh: OnboardingFacts = {
  profile: null,
  calendarConfirmed: false,
  activeMembers: 1,
  appointments: 0,
  customers: 0,
  dismissed: false,
};

describe('missingStammdaten', () => {
  it('lists everything without a profile', () => {
    expect(missingStammdaten(null)).toHaveLength(5);
  });

  it('accepts either tax number or VAT id and ignores whitespace-only values', () => {
    expect(missingStammdaten(fullProfile)).toEqual([]);
    expect(missingStammdaten({ ...fullProfile, vatId: ' ', city: '  ' })).toEqual(['Ort', 'Steuernummer oder USt-IdNr.']);
  });
});

describe('buildOnboardingStatus', () => {
  it('shows all required steps open for a new workshop', () => {
    const status = buildOnboardingStatus(fresh);
    expect(status.steps.map((step) => step.id)).toEqual(['stammdaten', 'kalender', 'mitarbeiter', 'termin', 'kunden']);
    expect(status.doneCount).toBe(0);
    expect(status.requiredCount).toBe(4);
    expect(status.visible).toBe(true);
    expect(status.steps[0].description).toContain('Firmenname');
  });

  it('counts the owner alone as no staff yet', () => {
    expect(buildOnboardingStatus({ ...fresh, activeMembers: 1 }).steps[2].done).toBe(false);
    expect(buildOnboardingStatus({ ...fresh, activeMembers: 2 }).steps[2].done).toBe(true);
  });

  it('is complete without the optional import step and then hides itself', () => {
    const status = buildOnboardingStatus({
      ...fresh,
      profile: fullProfile,
      calendarConfirmed: true,
      activeMembers: 3,
      appointments: 1,
    });
    expect(status.complete).toBe(true);
    expect(status.steps[4].done).toBe(false);
    expect(status.visible).toBe(false);
  });

  it('hides when dismissed even if steps are open', () => {
    const status = buildOnboardingStatus({ ...fresh, dismissed: true });
    expect(status.complete).toBe(false);
    expect(status.visible).toBe(false);
  });
});
