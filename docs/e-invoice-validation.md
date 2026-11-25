# E-Rechnung prüfen (ZUGFeRD / Factur-X, EN 16931)

WerkPilot erzeugt je ausgestellter Rechnung und Stornorechnung

- `…/finanzen/<id>/einvoice` → XML (EN 16931, UN/CEFACT CII)
- `…/finanzen/<id>/einvoice?format=pdf` → hybrides ZUGFeRD-PDF (PDF/A-3b mit eingebettetem `factur-x.xml`)

## Offizielle Prüfung mit dem Mustang-Validator

Der Validator prüft das PDF gegen PDF/A-3 (veraPDF) und das eingebettete XML gegen die Regeln von EN 16931 (Schematron).
Er ist ein Java-Programm und gehört **nicht** zum Projekt.

```bash
# einmalig herunterladen (Maven Central) und die Prüfsumme gegen die veröffentlichte SHA-1 vergleichen
curl -L -o mustang-cli.jar https://repo1.maven.org/maven2/org/mustangproject/Mustang-CLI/2.26.0/Mustang-CLI-2.26.0.jar
curl -s https://repo1.maven.org/maven2/org/mustangproject/Mustang-CLI/2.26.0/Mustang-CLI-2.26.0.jar.sha1
sha1sum mustang-cli.jar

# Rechnung (PDF oder XML) prüfen
java -jar mustang-cli.jar --action validate --source rechnung.pdf
```

Gutes Ergebnis: `Parsed PDF:valid XML:valid` und im PDF-Teil `flavour=3b … assertions=[], isCompliant=true`.

### Meldungen, die kein Fehler sind

Mustang prüft zusätzlich die Regeln der **XRechnung** (Rechnungen an Behörden). Diese Meldungen sind für ZUGFeRD/EN 16931 erwartet:

| Regel | Bedeutung |
|---|---|
| `PEPPOL-EN16931-R001` | Geschäftsprozess (nur Peppol) |
| `BR-DE-15` | Käuferreferenz / Leitweg-ID (nur Behörden) |
| `BR-DE-21` | Spezifikationskennung muss XRechnung sein |
| `BR-DE-1` | Zahlungsinformationen (bei Stornorechnungen nicht vorhanden) |

Jede **andere** Regelkennung ist ein echter Fehler und muss behoben werden.

## Stand der Prüfung

Am 17.11.2026 geprüft mit Mustang 2.26.0 gegen die Testumgebung: 18 von 18 Rechnungen (Rechnungen, Stornorechnungen,
stornierte Rechnungen, 19 %, 7 %, Kleinunternehmer, mehrere Einheiten) als XML und als ZUGFeRD-PDF vollständig gültig.

Die Prüfung hat einen echten Fehler gefunden und behoben: Regel `BR-CO-26` verlangt, dass der Verkäufer identifizierbar ist.
Eine Steuernummer allein genügt nicht, Betriebe ohne USt-IdNr. senden die Steuernummer deshalb zusätzlich als Verkäufer-Kennung.

## Nach jeder Änderung an `lib/e-invoice.ts` oder `lib/invoice-pdf.ts`

Mindestens ein Beispiel jeder Art erneut prüfen: Rechnung mit 19 %, mit 7 %, Kleinunternehmer (ohne USt-IdNr.), Stornorechnung, mehrseitige Rechnung und ein Name mit `&` oder `<`.
