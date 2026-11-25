import { formatInvoiceNumber } from './db/invoice-number-core';
import { UNITS } from './units';

/**
 * Template for the Verfahrensdokumentation (GoBD): the description of how a workshop records and keeps its
 * business data. WerkPilot fills in what the system itself does (these statements are checked against the
 * code); everything that only the workshop can answer is a "fill" block that stays empty for the owner.
 * It is a template and no legal advice: the final version belongs to the Steuerberater.
 */
export type ProcessBlock =
  | { kind: 'text'; text: string }
  | { kind: 'list'; items: string[] }
  /** To be filled in by the workshop. */
  | { kind: 'fill'; key: string; label: string; hint?: string };

export type ProcessSection = {
  id: string;
  title: string;
  blocks: ProcessBlock[];
};

export type ProcessDocumentInput = {
  companyName: string;
  ownerName: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  taxNumber: string | null;
  vatId: string | null;
  /** Date of this version (YYYY-MM-DD). */
  today: string;
};

export type ProcessDocument = {
  title: string;
  version: string;
  cover: Array<{ label: string; value: string }>;
  sections: ProcessSection[];
};

const text = (value: string): ProcessBlock => ({ kind: 'text', text: value });
const list = (...items: string[]): ProcessBlock => ({ kind: 'list', items });
const fill = (key: string, label: string, hint?: string): ProcessBlock => ({ kind: 'fill', key, label, ...(hint && { hint }) });

function formatDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}

const filled = (value: string | null): string | null => (value && value.trim() ? value.trim() : null);

export function buildProcessDocumentation(input: ProcessDocumentInput): ProcessDocument {
  const year = Number(input.today.slice(0, 4));
  const exampleNumber = formatInvoiceNumber(year, 1);
  const unitList = UNITS.map((unit) => `${unit.label} (${unit.name})`).join(', ');
  const address = [filled(input.street), [filled(input.zip), filled(input.city)].filter(Boolean).join(' ') || null]
    .filter(Boolean)
    .join(', ');

  const cover: Array<{ label: string; value: string }> = [
    { label: 'Betrieb', value: input.companyName.trim() },
    ...(filled(input.ownerName) ? [{ label: 'Inhaber/in', value: filled(input.ownerName) as string }] : []),
    ...(address ? [{ label: 'Anschrift', value: address }] : []),
    ...(filled(input.taxNumber) ? [{ label: 'Steuernummer', value: filled(input.taxNumber) as string }] : []),
    ...(filled(input.vatId) ? [{ label: 'USt-IdNr.', value: filled(input.vatId) as string }] : []),
    { label: 'Stand dieser Fassung', value: formatDate(input.today) },
  ];

  const sections: ProcessSection[] = [
    {
      id: 'zweck',
      title: '1. Zweck und Geltungsbereich',
      blocks: [
        text(
          'Diese Verfahrensdokumentation beschreibt, wie der Betrieb Kunden, Fahrzeuge, Termine, Aufträge, Rechnungen, Zahlungen und Lagerbestände mit der Software WerkPilot erfasst, verarbeitet, ändert und aufbewahrt. Sie soll einem sachverständigen Dritten, zum Beispiel bei einer Betriebsprüfung, in angemessener Zeit einen Überblick über das Verfahren geben (GoBD).',
        ),
        text(
          'Die Beschreibung des Systemverhaltens stammt aus WerkPilot und ist mit der Software abgestimmt. Die mit „Bitte ausfüllen“ markierten Angaben kann nur der Betrieb machen. Diese Vorlage ersetzt keine Steuerberatung; die endgültige Fassung sollte mit der Steuerberatung abgestimmt werden.',
        ),
      ],
    },
    {
      id: 'organisation',
      title: '2. Organisation und Verantwortlichkeiten',
      blocks: [
        fill('responsible', 'Verantwortliche Person für Rechnungsstellung und Buchführung'),
        fill('deputy', 'Vertretung bei Abwesenheit'),
        fill('tax-advisor', 'Steuerberatung (Name, Kontakt)'),
        fill('office-staff', 'Mitarbeiter mit Büro-Zugang (Rolle „office“) und ihre Aufgaben'),
        fill('onboarding', 'Einweisung neuer Mitarbeiter (wer, wann, wie dokumentiert)'),
        text('WerkPilot kennt drei Rollen: Inhaber (owner), Büro (office) und Mechaniker (mechanic). Die Rechte sind in Abschnitt 5.2 beschrieben.'),
      ],
    },
    {
      id: 'software',
      title: '3. Eingesetzte Software und nicht abgebildete Vorgänge',
      blocks: [
        list(
          'WerkPilot: webbasierte Werkstattsoftware (Termine, Aufträge, Rechnungen, Zahlungen, Lager, Berichte).',
          'Datenhaltung: PostgreSQL-Datenbank beim Dienstleister Supabase (Rechenzentrum in Frankfurt am Main). Zeitangaben und Rechnungsjahr beziehen sich auf die Zeitzone Europe/Berlin.',
          'Rechnungsformate: Druckansicht, E-Rechnung als XML (EN 16931) und als hybrides ZUGFeRD-PDF (PDF/A-3b mit eingebettetem XML).',
        ),
        text('Folgende Vorgänge bildet WerkPilot derzeit nicht ab. Sie müssen anderweitig dokumentiert werden:'),
        list(
          'Kassenführung und Bargeld (kein Kassenbuch, keine TSE).',
          'Finanzbuchhaltung und DATEV-Export (der Export für die Steuerberatung ist das Rechnungsjournal als CSV).',
          'Der Versand von Rechnungen und Mahnungen: WerkPilot erstellt Dokumente und Mahnentwürfe, versendet aber nichts.',
        ),
        fill('other-processes', 'Wie werden diese Vorgänge im Betrieb dokumentiert?', 'z. B. Kassenbuch in Papierform, Buchhaltungssoftware der Steuerberatung'),
      ],
    },
    {
      id: 'ablauf',
      title: '4. Anwenderdokumentation: Arbeitsabläufe',
      blocks: [
        text('4.1 Kunden und Fahrzeuge'),
        text('Kunden und ihre Fahrzeuge werden in „Kunden & Fahrzeuge“ erfasst. Daten werden nicht gelöscht, sondern archiviert, damit bestehende Rechnungen und Aufträge nachvollziehbar bleiben.'),
        text('4.2 Termine'),
        text('Termine werden im Kalender angelegt. Ein Arbeitsplatz und ein Mechaniker können nicht doppelt belegt werden; die Datenbank verhindert Überschneidungen. Urlaub, Krankheit und Schule werden als Abwesenheit erfasst.'),
        text('4.3 Aufträge und Kostenvoranschläge'),
        text('Ein Auftrag durchläuft die Stufen Entwurf, Kostenvoranschlag, Freigegeben, In Arbeit, Abgeschlossen und Rechnung erstellt. Eine Stufe kann nur in der vorgesehenen Reihenfolge erreicht werden.'),
        text('4.4 Rechnung erstellen und ausstellen'),
        list(
          'Eine Rechnung entsteht als Entwurf, entweder aus einem Auftrag oder von Hand. Entwürfe haben noch keine Rechnungsnummer und können geändert oder gelöscht werden.',
          `Beim Ausstellen erhält die Rechnung die nächste Nummer der fortlaufenden Nummernfolge im Format RE-JJJJ-NNNN (zum Beispiel ${exampleNumber}). Die Folge läuft je Kalenderjahr ohne Lücken; die Vergabe geschieht in einer Datenbanktransaktion mit Sperre.`,
          'Vor dem Ausstellen prüft WerkPilot die Pflichtangaben (Anschriften, Steuernummer oder USt-IdNr., Leistungsdatum, Positionen).',
          `Jede Position hat eine Menge mit Einheit (${unitList}). Beträge werden in Cent gerechnet und kaufmännisch gerundet (halbe Cent von null weg), getrennt je Position und Steuersatz.`,
          'Die Daten von Rechnungssteller und Rechnungsempfänger werden zum Zeitpunkt des Ausstellens in der Rechnung festgehalten. Spätere Änderungen an den Stammdaten verändern ausgestellte Rechnungen nicht.',
        ),
        text('4.5 Korrektur einer ausgestellten Rechnung (Storno)'),
        list(
          'Eine ausgestellte Rechnung wird nie geändert oder gelöscht. Fehler werden durch eine Stornorechnung korrigiert.',
          'Die Stornorechnung ist ein eigenes Dokument mit eigener Nummer aus derselben Nummernfolge. Sie enthält dieselben Positionen mit negativer Menge und nennt die stornierte Rechnung. Die stornierte Rechnung bleibt unverändert und wird als storniert gekennzeichnet.',
          'Die Summe aus Rechnung und Stornorechnung ist immer genau null. Eine Rechnung kann nur einmal storniert werden, eine Stornorechnung nicht erneut.',
          'Danach wird, falls nötig, eine neue, richtige Rechnung ausgestellt.',
        ),
        text('4.6 Zahlungen und Mahnwesen'),
        list(
          'Zahlungseingänge werden zur Rechnung erfasst, auch als Teilzahlung. Der Status wird aus Rechnungsbetrag, Zahlungen und Fälligkeit berechnet: offen, teilbezahlt, überfällig, bezahlt.',
          'Für überfällige Rechnungen erstellt WerkPilot Entwürfe für Zahlungserinnerung und Mahnungen. Sie enthalten keine Mahngebühren oder Zinsen und werden nicht versendet.',
        ),
        text('4.7 Lager'),
        text('Der Lagerbestand ergibt sich aus der Summe der Lagerbewegungen (Wareneingang, Verbrauch im Auftrag, Korrektur). Lagerbewegungen werden nicht verändert oder gelöscht; Korrekturen sind eigene Bewegungen.'),
        text('4.8 Berichte, Export und E-Rechnung'),
        list(
          'Das Rechnungsjournal zeigt alle ausgestellten Rechnungen und Stornorechnungen eines Zeitraums mit Umsätzen und Umsatzsteuer je Steuersatz und lässt sich als CSV für die Steuerberatung herunterladen.',
          'Jede ausgestellte Rechnung und Stornorechnung kann als E-Rechnung (XML) und als ZUGFeRD-PDF heruntergeladen werden.',
        ),
      ],
    },
    {
      id: 'technik',
      title: '5. Technische Systemdokumentation: eingebaute Kontrollen',
      blocks: [
        text('5.1 Trennung der Betriebe'),
        text('Die Daten jedes Betriebs sind in der Datenbank durch Zeilen-Zugriffsregeln (Row Level Security) getrennt und erzwungen. Ein Benutzer sieht nur Daten seines eigenen Betriebs.'),
        text('5.2 Rollen und Rechte'),
        list(
          'Inhaber (owner): alle Funktionen; nur der Inhaber verwaltet Mitarbeiter (einladen, Rolle ändern, Zugang sperren). Mitarbeiter werden gesperrt statt gelöscht, damit das Änderungsprotokoll vollständig bleibt.',
          'Büro (office): Termine, Aufträge, Lager, Finanzen, Rechnungen, Berichte, Änderungsprotokoll und Einstellungen; keine Mitarbeiterverwaltung.',
          'Mechaniker (mechanic): Termine, Aufträge, Lager sowie Rechnungen und Zahlungen (anlegen, ausstellen, stornieren, Berichte). Kein Zugriff auf Änderungsprotokoll, Einstellungen und Mitarbeiterverwaltung. Einkaufspreise werden für Mechaniker in der Anwendung ausgeblendet.',
          'Die Zugriffsrechte werden auf dem Server und in der Datenbank (Row Level Security) durchgesetzt; lediglich das Ausblenden der Einkaufspreise erfolgt in der Anwendung.',
        ),
        text('5.3 Unveränderbarkeit'),
        text('Ausgestellte Rechnungen und ihre Positionen sind durch Datenbank-Trigger geschützt: Sie können weder geändert noch gelöscht werden. Die einzige Ausnahme ist der Statuswechsel „ausgestellt“ zu „storniert“, und nur, wenn die zugehörige Stornorechnung bereits ausgestellt ist. Diese Regeln gelten auch für Administratoren der Anwendung.'),
        text('5.4 Änderungsprotokoll'),
        text('Jede Anlage, Änderung und Löschung bei Rechnungen, Zahlungen, Aufträgen und Lagerbewegungen wird automatisch mit Zeitpunkt, Benutzer und den geänderten Feldern protokolliert. Das Protokoll kann nicht geändert, gelöscht oder geleert werden und ist für Inhaber und Büro unter Finanzen einsehbar.'),
        text('5.5 Datenformate'),
        text('Beträge werden als ganze Cent gespeichert, Mengen in Tausendsteln, Steuersätze in Hundertstel Prozent; Gleitkommazahlen werden für Geld nicht verwendet. E-Rechnungen entsprechen EN 16931 und wurden mit dem Validator Mustang (PDF/A-3b und EN 16931) geprüft.'),
        text('5.6 Qualitätssicherung'),
        text('Die Regeln dieses Abschnitts sind durch automatische Tests der Software abgedeckt. Änderungen an der Software werden versioniert.'),
        fill('release-version', 'Version der Software und Datum der Freigabe für den Echtbetrieb', 'Die Steuerberatung hat Rechnungslayout und ZUGFeRD-Erzeugung am 17.11.2026 für den Echtbetrieb nach Abschluss der Testphase freigegeben.'),
      ],
    },
    {
      id: 'betrieb',
      title: '6. Betriebsdokumentation',
      blocks: [
        text('6.1 Datensicherung'),
        fill('backup', 'Datensicherung: Anbieter, Tarif, Häufigkeit, Aufbewahrungsdauer der Sicherungen', 'Für den Echtbetrieb ist ein Tarif mit täglicher Sicherung und Wiederherstellung zu einem Zeitpunkt nötig.'),
        fill('restore-test', 'Wann und wie wurde die Wiederherstellung zuletzt getestet?'),
        text('6.2 Aufbewahrung und Archivierung'),
        fill('retention', 'Aufbewahrungsfristen für Rechnungen, Buchungsbelege, Änderungsprotokoll und Verfahrensdokumentation', 'Fristen mit der Steuerberatung bestätigen.'),
        fill('archive', 'Wo werden Rechnungen als PDF/XML zusätzlich archiviert?', 'z. B. Ordner auf dem Server der Steuerberatung, Archivsystem'),
        text('6.3 Datenzugriff bei einer Betriebsprüfung'),
        text('Für den Datenzugriff der Finanzverwaltung stehen das Rechnungsjournal (CSV), die einzelnen Rechnungen als PDF und XML sowie das Änderungsprotokoll zur Verfügung.'),
        fill('audit-contact', 'Wer stellt die Daten bei einer Prüfung bereit?'),
        text('6.4 Zugangsverwaltung'),
        fill('user-admin', 'Wer legt Benutzer an und sperrt sie beim Ausscheiden?'),
        fill('passwords', 'Regeln für Passwörter und Zugangsdaten'),
        text('6.5 Störungen und Ausfall'),
        fill('outage', 'Vorgehen bei Ausfall der Software (Notbetrieb, Nachtragen von Belegen)'),
      ],
    },
    {
      id: 'kontrolle',
      title: '7. Interne Kontrolle (Vorschlag)',
      blocks: [
        text('Vorgeschlagene regelmäßige Prüfungen. Die Durchführung wird vom Betrieb festgelegt und dokumentiert.'),
        list(
          'Monatlich: Rechnungsjournal des Vormonats als CSV exportieren und an die Steuerberatung geben.',
          'Monatlich: Nummernfolge im Journal auf Lücken prüfen (die Software vergibt lückenlos; eine Lücke wäre ein Hinweis auf ein Problem).',
          'Monatlich: offene und überfällige Rechnungen durchgehen.',
          'Vierteljährlich: Stichprobe im Änderungsprotokoll.',
          'Jährlich: Benutzerliste und Rollen prüfen, Wiederherstellung der Datensicherung testen.',
        ),
        fill('controls', 'Festgelegte Kontrollen, Zuständigkeit und Ablage der Nachweise'),
      ],
    },
    {
      id: 'historie',
      title: '8. Änderungshistorie dieser Dokumentation',
      blocks: [
        text(`Version vom ${formatDate(input.today)}: erste Fassung aus der Vorlage.`),
        fill('changes', 'Weitere Änderungen (Datum, Änderung, verantwortliche Person)'),
      ],
    },
  ];

  return {
    title: 'Verfahrensdokumentation nach GoBD',
    version: formatDate(input.today),
    cover,
    sections,
  };
}

/** Keys of all fill-in fields: the only keys the answers API accepts. */
export function getProcessFieldKeys(document: ProcessDocument): string[] {
  return document.sections.flatMap((section) => section.blocks.flatMap((block) => (block.kind === 'fill' ? [block.key] : [])));
}

/** The questions only the workshop can answer, for the "still open" counter. */
export function countOpenFields(document: ProcessDocument): number {
  return document.sections.reduce((sum, section) => sum + section.blocks.filter((block) => block.kind === 'fill').length, 0);
}
