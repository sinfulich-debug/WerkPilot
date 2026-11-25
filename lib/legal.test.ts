import { describe, expect, it } from 'vitest';
import { LEGAL_ENTITY, legalValue, MISSING, missingLegalFields, type LegalEntity } from './legal';
import { isPublicPath, needsWorkshop } from './public-paths';

const complete: LegalEntity = {
  companyName: 'Muster Software GmbH', legalForm: 'GmbH', representative: 'Max Muster', street: 'Hauptstr. 1',
  zipCity: '80331 München', email: 'info@example.de', phone: null, registerCourt: null, registerNumber: null,
  vatId: null, supervisoryAuthority: 'Bayerisches Landesamt für Datenschutzaufsicht',
};

describe('legal pages', () => {
  it('shows a placeholder for missing values', () => {
    expect(legalValue(null)).toBe(MISSING);
    expect(legalValue('  ')).toBe(MISSING);
    expect(legalValue(' GmbH ')).toBe('GmbH');
  });

  it('counts the page as draft until the required data is filled in', () => {
    expect(missingLegalFields(complete)).toEqual([]);
    expect(missingLegalFields({ ...complete, email: null })).toEqual(['email']);
    // reminder: the shipped data is still empty, so every page shows the draft notice
    expect(missingLegalFields(LEGAL_ENTITY).length).toBeGreaterThan(0);
  });

  it('opens Impressum, Datenschutz and AGB without login and without a workshop', () => {
    for (const path of ['/impressum', '/datenschutz', '/agb']) {
      expect(isPublicPath(path)).toBe(true);
      expect(needsWorkshop(path)).toBe(false);
    }
  });
});
