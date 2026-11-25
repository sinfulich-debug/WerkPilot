# WerkPilot: Rechnungsvorlage zur Prüfung durch den Steuerberater

Stand: November 2026 · Entwurf zur Abstimmung, keine Rechtsberatung.

**Status der Freigabe:** Die Steuerberaterin (Dr. Weber) hat die Vorlage am 17.11.2026 schriftlich freigegeben (Vermerk, Abschrift in `freigabe-steuerberater-2026-11-17.md`), für den Echtbetrieb nach Abschluss der Testphase. Die zwölf Fragen in Abschnitt 4 sind im Vermerk nicht einzeln beantwortet und bleiben offen.

Ziel: schriftliche Freigabe der Rechnungsvorlage (Druckansicht) und der Storno-Logik, **bevor** ein E-Rechnungsformat (ZUGFeRD / XRechnung) umgesetzt wird.
Die Druckansicht ist unter `/finanzen/<Rechnungs-ID>/druck` abrufbar (Beispielrechnungen in der Testumgebung).

## 1. Pflichtangaben nach § 14 Abs. 4 UStG: Was die Vorlage zeigt

| Nr. | Pflichtangabe | In der Vorlage | Anmerkung |
|---|---|---|---|
| 1 | Name und Anschrift von Leistendem und Leistungsempfänger | Kopfbereich: Empfänger links, Rechnungssteller rechts | Aus den Stammdaten **zum Zeitpunkt der Ausstellung** gespeichert (Snapshot). Spätere Änderungen verändern die Rechnung nicht. |
| 2 | Steuernummer oder USt-IdNr. des Leistenden | Fußzeile | Ausstellen ist nur mit einer der beiden Angaben möglich. |
| 3 | Ausstellungsdatum | „Rechnungsdatum“ | Wird beim Ausstellen gesetzt (Zeitzone Europe/Berlin). |
| 4 | Fortlaufende Rechnungsnummer | „Rechnungsnummer“, Format `RE-JJJJ-NNNN` | Lückenlos je Kalenderjahr, vergeben in einer Datenbanktransaktion mit Sperre. |
| 5 | Menge und Art der Leistung | Tabelle: Leistung / Artikel, Menge mit Einheit | Einheit je Position wählbar: Stk., Std., pauschal, Satz, l, kg, m. Aus einem Auftrag: Arbeit in Stunden, Teile in Stück. |
| 6 | Zeitpunkt der Leistung | „Leistungsdatum“ | Ein einzelnes Datum, kein Leistungszeitraum. |
| 7 | Entgelt nach Steuersätzen aufgeschlüsselt | Zeilenbeträge netto, „Nettobetrag“ | Pro Rechnung ein Steuersatz (siehe Frage 5). Rabatte werden vor der Rechnung in den Einzelpreis eingerechnet. |
| 8 | Steuersatz und Steuerbetrag oder Hinweis auf Steuerbefreiung | „Umsatzsteuer 19 % / 7 %“ bzw. Hinweis „Kein Umsatzsteuerausweis gemäß § 19 UStG“ | Kleinunternehmerregelung ist als Steuerart wählbar. |
| 9 | Hinweis auf Aufbewahrungspflicht des Empfängers (§ 14b) | nicht enthalten | Betrifft Leistungen im Zusammenhang mit einem Grundstück; bitte bestätigen, dass es für Kfz-Werkstätten nicht relevant ist. |
| 10 | Angabe „Gutschrift“ bei Gutschriften | nicht relevant | Es werden keine Gutschriften im Sinne des § 14 Abs. 2 Satz 2 UStG ausgestellt, nur Stornorechnungen (Abschnitt 2). |

Die Anwendung prüft zusätzlich selbst auf fehlende Angaben und zeigt in der Druckansicht eine Warnung (nicht gedruckt).

## 2. Stornierung (Gutschrift / Stornorechnung)

- Eine ausgestellte Rechnung wird **nie verändert oder gelöscht**.
- Stornierung = neues, **eigenes nummeriertes Dokument** (gleicher Nummernkreis `RE-JJJJ-NNNN`) mit denselben Positionen in **negativer Menge**; Einzelpreise und Steuersätze bleiben gleich.
- Die Stornorechnung nennt die stornierte Rechnung („STORNORECHNUNG zu Rechnung RE-…“). Die Originalrechnung wird als „STORNIERT durch …“ gekennzeichnet.
- Rundung: kaufmännisch, Halbcent von null weg, getrennt je Zeile und je Steuersatz. Dadurch ist die Summe aus Rechnung und Storno **immer genau 0,00 €** (automatisierte Tests).
- Eine Rechnung kann nur einmal storniert werden; eine Stornorechnung kann nicht erneut storniert werden. Die Datenbank erzwingt das.
- Zahlungen auf eine stornierte Rechnung bleiben bestehen und müssen separat erstattet werden.

## 3. Unveränderbarkeit und Nachvollziehbarkeit (GoBD)

- Ausgestellte Rechnungen und ihre Positionen sind per Datenbank-Trigger unveränderbar.
- Änderungsprotokoll: jede Änderung an Rechnungen, Zahlungen, Aufträgen und Lagerbewegungen wird automatisch mit Zeitpunkt und Benutzer festgehalten; das Protokoll kann nicht geändert oder gelöscht werden (`/finanzen/protokoll`).
- Rechnungsjournal je Zeitraum als CSV mit Umsätzen je Steuersatz (siehe Abschnitt 5).

## 4. Fragen an den Steuerberater

1. **Pflichtangaben:** Sind die Angaben in Abschnitt 1 für unsere Rechnungen vollständig? Fehlt etwas?
2. **Rechtsform:** Bei Kapitalgesellschaften (z. B. GmbH) sind auf Geschäftsbriefen weitere Angaben üblich/vorgeschrieben (Registergericht, Handelsregisternummer, Geschäftsführer). Aktuell gibt es dafür keine Felder. Welche sollen in die Fußzeile?
3. **Nummernkreis:** Ist ein gemeinsamer lückenloser Nummernkreis für Rechnungen und Stornorechnungen in Ordnung, oder soll die Stornorechnung ein eigenes Präfix erhalten (z. B. `ST-`)?
4. **Mengeneinheiten:** Umgesetzt (Std., Stk., pauschal, Satz, l, kg, m). Fehlt eine Einheit?
5. **Mehrere Steuersätze:** Aktuell hat jede Rechnung genau einen Steuersatz. Wird eine Rechnung mit gemischten Sätzen (z. B. 19 % und 7 %) gebraucht?
6. **Leistungszeitraum:** Reicht ein Leistungsdatum, oder soll auch ein Zeitraum möglich sein?
7. **Zahlungsbedingungen:** Gewünschte Standardformulierung (z. B. „Zahlbar ohne Abzug bis …“), Skonto?
8. **Mahnwesen:** Die Mahnentwürfe (Zahlungserinnerung, 1. und 2. Mahnung) enthalten bewusst **keine** Mahngebühren und Verzugszinsen. Welche Regeln und Beträge sollen gelten?
9. **Aufbewahrung:** Bitte aktuelle Aufbewahrungsfristen für Rechnungen, Buchungsbelege und das Änderungsprotokoll bestätigen. Wie lange sollen Daten nach Vertragsende (Kündigung durch die Werkstatt) vorgehalten werden?
10. **E-Rechnung:** Empfang ist seit 2025 verpflichtend; Ausstellung schrittweise bis 2027/2028 (abhängig vom Vorjahresumsatz). Bitte bestätigen, ab wann die Werkstätten der Zielgruppe ausstellen müssen und ob ZUGFeRD (PDF mit eingebettetem XML) oder XRechnung bevorzugt wird.
11. **Verfahrensdokumentation:** Welche Inhalte muss die Werkstatt dokumentieren? (WerkPilot liefert später eine Vorlage.)
12. **Kassenführung:** Sollen Barzahlungen erfasst werden? Falls ja, welche Anforderungen (Kassenbuch, TSE) gelten?

## 5. Beispiel-Auswertung

Unter `/finanzen/berichte` lässt sich das Rechnungsjournal für einen Zeitraum ansehen und als CSV (Excel-kompatibel, Semikolon, Dezimalkomma) herunterladen. Die Summen je Steuersatz enthalten Stornorechnungen mit negativem Vorzeichen.

## 6. E-Rechnung (Datenformat, nach der Freigabe der Vorlage umgesetzt)

Jede ausgestellte Rechnung und jede Stornorechnung lässt sich als XML-Datei herunterladen („E-Rechnung (XML)“ in der Rechnungsliste und in der Druckansicht).

- Format: UN/CEFACT Cross Industry Invoice, Profil **EN 16931** (`urn:cen.eu:en16931:2017`), das Datenformat von ZUGFeRD 2.x / Factur-X.
- Rechnung = Dokumenttyp **380**. Stornorechnung = Dokumenttyp **381 (Gutschrift)** mit positiven Beträgen und Verweis auf die stornierte Rechnung, weil EN 16931 keine negativen Preise erlaubt. Die Beträge sind exakt dieselben wie in Rechnung, Druckansicht und Journal (automatisch gegengeprüft).
- Kleinunternehmer: Steuerkategorie „E“ mit dem Hinweis „Kein Umsatzsteuerausweis gemäß § 19 UStG“.
- Zahlungsart 58 (SEPA-Überweisung) mit IBAN/BIC, sofern hinterlegt.
- Es wird **keine unvollständige** E-Rechnung erzeugt: fehlen Pflichtangaben, nennt die Anwendung sie und bricht ab.
- **Hybrides ZUGFeRD-PDF** (PDF/A-3b mit eingebettetem `factur-x.xml`) ist ebenfalls abrufbar (`?format=pdf`, „ZUGFeRD-PDF“ in der Rechnungsliste).
- Mengeneinheit je Position nach UN/ECE Recommendation 20 (z. B. `HUR` Stunde, `C62` Stück, `LS` pauschal).
- **Offiziell geprüft:** mit dem Mustang-Validator (veraPDF für PDF/A-3b, Schematron für EN 16931) am 17.11.2026: 18 von 18 Dokumenten der Testumgebung vollständig gültig, als XML und als PDF. Ablauf und Hinweise: `docs/e-invoice-validation.md`.
- **Noch nicht enthalten:** XRechnung-Besonderheiten für Behörden (Leitweg-ID, Käuferreferenz); die Prüfung meldet dazu erwartungsgemäß `BR-DE-15` / `BR-DE-21`.

Zusätzliche Fragen dazu: (a) Ist Dokumenttyp 381 für Stornorechnungen gewünscht, oder soll Typ 384 (korrigierte Rechnung) verwendet werden? (b) Reicht das hybride ZUGFeRD-PDF für Geschäftskunden aus, oder werden Rechnungen an Behörden (XRechnung) benötigt?

## Freigabe

| | |
|---|---|
| Geprüft von | Dr. Weber, Steuerberaterin (Steuerberaterkanzlei Dr. Weber & Partner) |
| Datum | 17.11.2026 |
| Freigegeben: | ☑ ja (für den Echtbetrieb nach Abschluss der Testphase) |
| Anmerkungen | Vermerk liegt vor, siehe `freigabe-steuerberater-2026-11-17.md`. Die Fragen in Abschnitt 4 sind weiter offen. |
