import type { Metadata } from 'next';
import LegalPage from '../../components/LegalPage';
import { LEGAL_ENTITY as e, legalValue as v } from '../../lib/legal';

export const metadata: Metadata = { title: 'WerkPilot | Impressum' };

export default function ImpressumPage() {
  return (
    <LegalPage title="Impressum">
      <h2>Angaben gemäß § 5 DDG</h2>
      <p>
        {v(e.companyName)}{e.legalForm ? ` (${e.legalForm})` : ''}<br />
        {v(e.street)}<br />
        {v(e.zipCity)}<br />
        Deutschland
      </p>
      <p>Vertreten durch: {v(e.representative)}</p>

      <h2>Kontakt</h2>
      <p>
        E-Mail: {v(e.email)}<br />
        {e.phone ? <>Telefon: {e.phone}</> : null}
      </p>

      {(e.registerCourt || e.registerNumber) && (
        <>
          <h2>Registereintrag</h2>
          <p>Registergericht: {v(e.registerCourt)}<br />Registernummer: {v(e.registerNumber)}</p>
        </>
      )}

      {e.vatId && (
        <>
          <h2>Umsatzsteuer-ID</h2>
          <p>Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: {e.vatId}</p>
        </>
      )}

      <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
      <p>{v(e.representative)}, Anschrift wie oben</p>

      <h2>Verbraucherstreitbeilegung</h2>
      <p>
        WerkPilot richtet sich ausschließlich an Unternehmer. Wir sind nicht bereit und nicht verpflichtet, an
        Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
      </p>
    </LegalPage>
  );
}
