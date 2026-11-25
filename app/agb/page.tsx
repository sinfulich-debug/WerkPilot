import type { Metadata } from 'next';
import LegalPage from '../../components/LegalPage';
import { TRIAL_DAYS } from '../../lib/billing';
import { LEGAL_ENTITY as e, legalValue as v } from '../../lib/legal';

export const metadata: Metadata = { title: 'WerkPilot | AGB' };

export default function AgbPage() {
  return (
    <LegalPage title="Allgemeine Geschäftsbedingungen">
      <h2>§ 1 Geltungsbereich</h2>
      <p>
        Diese AGB gelten für die Nutzung der Software WerkPilot, die {v(e.companyName)} („Anbieter“) als
        Online-Dienst bereitstellt. Das Angebot richtet sich ausschließlich an Unternehmer im Sinne von § 14 BGB,
        insbesondere Kfz-Werkstätten („Kunde“). Abweichende Bedingungen des Kunden gelten nicht.
      </p>

      <h2>§ 2 Vertragsschluss und Testphase</h2>
      <p>
        Der Vertrag kommt mit der Registrierung zustande. Die ersten {TRIAL_DAYS} Tage sind kostenlos. Nach der
        Testphase kann WerkPilot nur mit einem kostenpflichtigen Abo weiter genutzt werden; ohne Abo bleiben die Daten
        gespeichert, die Nutzung ist aber gesperrt. Die Testphase endet ohne Kündigung und ohne Kosten.
      </p>

      <h2>§ 3 Leistungen</h2>
      <p>
        Der Anbieter stellt WerkPilot im Browser zur Verfügung, mit dem Funktionsumfang, der bei Vertragsschluss
        beschrieben ist. Der Anbieter darf die Software weiterentwickeln, solange wesentliche Funktionen erhalten
        bleiben. Wartungsarbeiten werden nach Möglichkeit außerhalb der üblichen Geschäftszeiten durchgeführt.
      </p>

      <h2>§ 4 Preise und Zahlung</h2>
      <p>
        Es gilt der beim Abschluss des Abos angezeigte Preis zuzüglich gesetzlicher Umsatzsteuer. Das Abo wird im
        Voraus für den jeweiligen Abrechnungszeitraum per SEPA-Lastschrift oder Karte über den Zahlungsdienstleister
        Stripe abgerechnet. Schlägt eine Zahlung fehl, darf der Anbieter den Zugang nach erfolgloser Erinnerung sperren.
      </p>

      <h2>§ 5 Laufzeit und Kündigung</h2>
      <p>
        Das Abo verlängert sich jeweils um den gewählten Abrechnungszeitraum, wenn es nicht vorher gekündigt wird. Der
        Kunde kann jederzeit zum Ende des laufenden Zeitraums in WerkPilot unter „Abo“ kündigen. Das Recht zur
        außerordentlichen Kündigung aus wichtigem Grund bleibt unberührt.
      </p>

      <h2>§ 6 Pflichten des Kunden</h2>
      <p>
        Der Kunde hält seine Zugangsdaten geheim, legt Konten nur für eigene Mitarbeiter an und gibt keine
        rechtswidrigen Inhalte ein. Der Kunde bleibt dafür verantwortlich, dass seine Rechnungen, Aufbewahrung und
        Buchführung den gesetzlichen Vorgaben entsprechen; WerkPilot ist ein Hilfsmittel und ersetzt keine steuerliche
        Beratung.
      </p>

      <h2>§ 7 Daten des Kunden</h2>
      <p>
        Die eingegebenen Daten gehören dem Kunden. Personenbezogene Daten seiner Kunden verarbeitet der Anbieter nur im
        Auftrag des Kunden nach dem gesonderten Vertrag zur Auftragsverarbeitung (AVV). Nach Vertragsende kann der Kunde
        seine Daten 30 Tage lang exportieren; danach werden sie gelöscht, soweit keine gesetzliche Aufbewahrungspflicht
        besteht.
      </p>

      <h2>§ 8 Haftung</h2>
      <p>
        Der Anbieter haftet unbeschränkt bei Vorsatz, grober Fahrlässigkeit, bei Verletzung von Leben, Körper oder
        Gesundheit und nach dem Produkthaftungsgesetz. Bei leichter Fahrlässigkeit haftet er nur für die Verletzung
        wesentlicher Vertragspflichten und begrenzt auf den vertragstypischen, vorhersehbaren Schaden.
      </p>

      <h2>§ 9 Änderungen dieser AGB</h2>
      <p>
        Änderungen werden dem Kunden mindestens sechs Wochen vorher per E-Mail mitgeteilt. Widerspricht der Kunde nicht
        bis zum Inkrafttreten, gelten sie als angenommen; auf diese Folge wird in der Mitteilung hingewiesen.
      </p>

      <h2>§ 10 Schlussbestimmungen</h2>
      <p>
        Es gilt deutsches Recht unter Ausschluss des UN-Kaufrechts. Gerichtsstand ist, soweit zulässig, der Sitz des
        Anbieters ({v(e.zipCity)}).
      </p>
    </LegalPage>
  );
}
