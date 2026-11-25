import Link from 'next/link';
import { LEGAL_ENTITY, LEGAL_TEXTS_DATE, missingLegalFields } from '../lib/legal';

/** Frame for Impressum, Datenschutz and AGB: readable without login, with a draft notice while data is missing. */
export default function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  const isDraft = missingLegalFields(LEGAL_ENTITY).length > 0;
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <article className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-soft ring-1 ring-slate-200/80 md:p-10">
        <p className="text-sm font-medium text-slate-500">WerkPilot</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight text-slate-900">{title}</h1>
        {isDraft && (
          <p role="note" className="mt-5 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
            Entwurf: Angaben des Anbieters fehlen noch, und der Text ist noch nicht anwaltlich geprüft.
          </p>
        )}
        <div className="legal mt-6 space-y-4 text-sm leading-6 text-slate-700 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-medium [&_h2]:text-slate-900 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
        <p className="mt-10 text-xs text-slate-400">Stand: {LEGAL_TEXTS_DATE}</p>
        <nav className="mt-4 flex flex-wrap gap-4 text-sm">
          <Link href="/impressum" className="text-accent-700 hover:underline">Impressum</Link>
          <Link href="/datenschutz" className="text-accent-700 hover:underline">Datenschutz</Link>
          <Link href="/agb" className="text-accent-700 hover:underline">AGB</Link>
          <Link href="/login" className="text-accent-700 hover:underline">Anmelden</Link>
        </nav>
      </article>
    </main>
  );
}
