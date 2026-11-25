import type { Metadata } from 'next';
import LegalPage from '../../components/LegalPage';
import { LEGAL_ENTITY as e, legalValue as v } from '../../lib/legal';

export const metadata: Metadata = { title: 'WerkPilot | Datenschutz' };

export default function DatenschutzPage() {
  return (
    <LegalPage title="Datenschutzerklärung">
      <h2>1. Verantwortlicher</h2>
      <p>
        {v(e.companyName)}, {v(e.street)}, {v(e.zipCity)}, E-Mail: {v(e.email)}. Vertreten durch {v(e.representative)}.
      </p>

      <h2>2. Zwei Rollen: Ihre Kontodaten und die Daten Ihrer Kunden</h2>
      <p>
        Für die Daten Ihres Kontos (Name, E-Mail-Adresse, Werkstattdaten, Abo) sind wir Verantwortlicher im Sinne der
        DSGVO. Die Daten, die Ihre Werkstatt in WerkPilot über ihre eigenen Kunden und Fahrzeuge speichert, verarbeiten
        wir nur in Ihrem Auftrag (Art. 28 DSGVO). Dafür schließen wir mit Ihnen einen Vertrag zur Auftragsverarbeitung
        (AVV); verantwortlich für diese Daten bleibt Ihre Werkstatt.
      </p>

      <h2>3. Welche Daten wir verarbeiten und warum</h2>
      <ul>
        <li>
          <strong>Registrierung und Anmeldung:</strong> E-Mail-Adresse, Passwort (nur verschlüsselt gespeichert),
          Werkstattname, Zeitpunkt der Zustimmung zu AGB und Datenschutzerklärung. Zweck: Bereitstellung des Kontos.
          Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (Vertrag).
        </li>
        <li>
          <strong>Nutzung der App:</strong> die Inhalte, die Sie eingeben (Termine, Aufträge, Rechnungen,
          Mitarbeiterkonten) und ein Änderungsprotokoll. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO; für Rechnungen
          zusätzlich gesetzliche Aufbewahrungspflichten (Art. 6 Abs. 1 lit. c DSGVO, § 147 AO, § 14b UStG).
        </li>
        <li>
          <strong>Abo und Zahlung:</strong> Rechnungsanschrift, Zahlungsart und Zahlungsstatus. Die Zahlungsdaten (z. B.
          IBAN oder Kartennummer) gibt Ihr Browser direkt an unseren Zahlungsdienstleister Stripe weiter; wir sehen sie
          nicht. Rechtsgrundlage: Art. 6 Abs. 1 lit. b und c DSGVO.
        </li>
        <li>
          <strong>Sicherheit und Fehlerbehebung:</strong> technische Protokolle, Fehlerberichte ohne Cookies,
          Formularinhalte und IP-Adressen, und für öffentliche Links (Freigabe eines Kostenvoranschlags,
          Registrierung) ein Zähler pro gehashter IP-Adresse, der nach spätestens einem Tag gelöscht wird.
          Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem sicheren, funktionierenden Dienst).
        </li>
      </ul>

      <h2>4. Cookies</h2>
      <p>
        WerkPilot setzt nur technisch notwendige Cookies, die Ihre Anmeldung speichern (§ 25 Abs. 2 TDDDG). Es gibt
        keine Werbe- oder Analyse-Cookies und kein Tracking.
      </p>

      <h2>5. Empfänger und Dienstleister</h2>
      <ul>
        <li><strong>Supabase</strong> (Datenbank und Anmeldung), Rechenzentrum in Frankfurt am Main.</li>
        <li><strong>Vercel</strong> (Hosting der Web-App).</li>
        <li><strong>Stripe</strong> (Abo-Zahlungen, SEPA-Lastschrift und Karte).</li>
        <li><strong>Sentry</strong> (Fehlerberichte, Datenhaltung in der EU).</li>
      </ul>
      <p>
        Mit allen Dienstleistern bestehen Verträge zur Auftragsverarbeitung. Soweit Daten in die USA übermittelt
        werden können, stützen wir uns auf den EU-US Data Privacy Framework bzw. auf Standardvertragsklauseln der
        EU-Kommission.
      </p>

      <h2>6. Speicherdauer</h2>
      <p>
        Kontodaten speichern wir, solange das Konto besteht. Rechnungen und buchungsrelevante Unterlagen bewahren wir
        so lange auf, wie es das Gesetz verlangt (in der Regel 8 bis 10 Jahre). Danach werden die Daten gelöscht.
      </p>

      <h2>7. Ihre Rechte</h2>
      <p>
        Sie haben das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der
        Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch gegen Verarbeitungen auf Grundlage
        berechtigter Interessen (Art. 21 DSGVO). Schreiben Sie uns dazu an {v(e.email)}.
      </p>
      <p>
        Sie können sich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren, zum Beispiel bei der für uns
        zuständigen Behörde: {v(e.supervisoryAuthority)}.
      </p>
    </LegalPage>
  );
}
