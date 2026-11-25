/**
 * First-run checklist of a workshop: Stammdaten -> Bundesland -> Mitarbeiter -> erster Termin.
 * Pure: the facts are read from the database, the steps are derived here.
 */

export type OnboardingFacts = {
  profile: {
    companyName: string | null;
    street: string | null;
    zip: string | null;
    city: string | null;
    taxNumber: string | null;
    vatId: string | null;
  } | null;
  calendarConfirmed: boolean;
  /** Active members including the owner. */
  activeMembers: number;
  appointments: number;
  customers: number;
  dismissed: boolean;
};

export type OnboardingStepId = 'stammdaten' | 'kalender' | 'mitarbeiter' | 'termin' | 'kunden';

export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  description: string;
  href: string;
  done: boolean;
  /** Optional steps are shown but do not block "fertig". */
  optional: boolean;
};

export type OnboardingStatus = {
  steps: OnboardingStep[];
  doneCount: number;
  requiredCount: number;
  complete: boolean;
  /** The card is shown while something required is open and the owner has not hidden it. */
  visible: boolean;
};

const filled = (value: string | null | undefined) => Boolean(value?.trim());

/** The same fields an invoice needs (see validateInvoiceForIssue): without them no invoice can be issued. */
export function missingStammdaten(profile: OnboardingFacts['profile']): string[] {
  if (!profile) return ['Firmenname', 'Straße', 'PLZ', 'Ort', 'Steuernummer oder USt-IdNr.'];
  const missing: string[] = [];
  if (!filled(profile.companyName)) missing.push('Firmenname');
  if (!filled(profile.street)) missing.push('Straße');
  if (!filled(profile.zip)) missing.push('PLZ');
  if (!filled(profile.city)) missing.push('Ort');
  if (!filled(profile.taxNumber) && !filled(profile.vatId)) missing.push('Steuernummer oder USt-IdNr.');
  return missing;
}

export function buildOnboardingStatus(facts: OnboardingFacts): OnboardingStatus {
  const missing = missingStammdaten(facts.profile);
  const steps: OnboardingStep[] = [
    {
      id: 'stammdaten',
      title: 'Stammdaten eintragen',
      description:
        missing.length === 0
          ? 'Firmenname, Anschrift und Steuernummer sind hinterlegt.'
          : `Für Rechnungen fehlt noch: ${missing.join(', ')}.`,
      href: '/einstellungen',
      done: missing.length === 0,
      optional: false,
    },
    {
      id: 'kalender',
      title: 'Bundesland und Arbeitszeiten festlegen',
      description: 'Das Bundesland bestimmt die Feiertage im Kalender.',
      href: '/termine?einstellungen=1',
      done: facts.calendarConfirmed,
      optional: false,
    },
    {
      id: 'mitarbeiter',
      title: 'Mitarbeiter anlegen',
      description: 'Mechaniker und Büro bekommen eigene Zugänge (nur Inhaber).',
      href: '/einstellungen/mitarbeiter',
      done: facts.activeMembers > 1,
      optional: false,
    },
    {
      id: 'termin',
      title: 'Ersten Termin eintragen',
      description: 'Im Kalender auf einen freien Platz klicken.',
      href: '/termine',
      done: facts.appointments > 0,
      optional: false,
    },
    {
      id: 'kunden',
      title: 'Bestandskunden importieren',
      description: 'Kunden und Fahrzeuge als CSV aus Excel oder der alten Software übernehmen.',
      href: '/kunden/import',
      done: facts.customers > 0,
      optional: true,
    },
  ];

  const required = steps.filter((step) => !step.optional);
  const doneCount = required.filter((step) => step.done).length;
  const complete = doneCount === required.length;
  return {
    steps,
    doneCount,
    requiredCount: required.length,
    complete,
    visible: !complete && !facts.dismissed,
  };
}
