/**
 * Data of the company that operates WerkPilot, shown on Impressum, Datenschutz and AGB.
 * Fill in every field before going live. While anything is missing, the pages show a draft notice
 * and "[bitte ergänzen]" in place of the gap. The texts are drafts and must be checked by a lawyer.
 */
export type LegalEntity = {
  companyName: string | null; // e.g. "Muster Software GmbH" or the owner's name for a sole trader
  legalForm: string | null; // e.g. "GmbH", "Einzelunternehmen"
  representative: string | null; // managing director / owner
  street: string | null;
  zipCity: string | null;
  email: string | null;
  phone: string | null;
  registerCourt: string | null; // e.g. "Amtsgericht München" (only for registered companies)
  registerNumber: string | null; // e.g. "HRB 123456"
  vatId: string | null; // USt-IdNr. (§ 27a UStG)
  supervisoryAuthority: string | null; // data protection authority of the company's federal state
};

export const LEGAL_ENTITY: LegalEntity = {
  companyName: null,
  legalForm: null,
  representative: null,
  street: null,
  zipCity: null,
  email: null,
  phone: null,
  registerCourt: null,
  registerNumber: null,
  vatId: null,
  supervisoryAuthority: null,
};

export const MISSING = '[bitte ergänzen]';

/** The value, or the visible placeholder. */
export function legalValue(value: string | null): string {
  return value && value.trim() ? value.trim() : MISSING;
}

/** Fields required on every page (register and VAT ID are optional for small sole traders). */
const REQUIRED: Array<keyof LegalEntity> = ['companyName', 'representative', 'street', 'zipCity', 'email', 'supervisoryAuthority'];

export function missingLegalFields(entity: LegalEntity): Array<keyof LegalEntity> {
  return REQUIRED.filter((key) => !entity[key]?.trim());
}

/** Last change of the texts, shown at the bottom of each page. */
export const LEGAL_TEXTS_DATE = '19.11.2026';
