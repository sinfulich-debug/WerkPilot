import Link from 'next/link';
import PrintInvoiceButton from '../../../components/PrintInvoiceButton';
import ProcessFillField from '../../../components/ProcessFillField';
import { getDateStringInTimeZone, INVOICE_TIME_ZONE } from '../../../lib/date';
import { getProcessAnswers } from '../../../lib/db/process-documentation';
import { getWorkshopProfile } from '../../../lib/db/workshop';
import { buildProcessDocumentation, getProcessFieldKeys, type ProcessBlock } from '../../../lib/process-documentation';
import { ForbiddenError, requireRole } from '../../../lib/requireRole';

/** Lines such as "4.1 Kunden und Fahrzeuge" are sub-headings inside a section. */
const SUBHEADING = /^\d+\.\d+ /;

function Block({ block, answers }: { block: ProcessBlock; answers: Record<string, string> }) {
  if (block.kind === 'list') {
    return (
      <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-slate-800">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  if (block.kind === 'fill') {
    return <ProcessFillField fieldKey={block.key} label={block.label} hint={block.hint} initialValue={answers[block.key] ?? ''} />;
  }
  if (SUBHEADING.test(block.text)) {
    return <h3 className="mt-5 text-base font-medium text-slate-900">{block.text}</h3>;
  }
  return <p className="mt-2 text-sm leading-relaxed text-slate-800">{block.text}</p>;
}

export default async function ProcessDocumentationPage() {
  // Owner and office only: the document describes access rules and finances.
  let context;
  try {
    context = await requireRole(['owner', 'office']);
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error;
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <section className="max-w-md rounded-3xl bg-white p-8 text-center shadow-soft ring-1 ring-slate-200/80">
          <h1 className="text-xl font-medium text-slate-900">Verfahrensdokumentation</h1>
          <p role="alert" className="mt-3 text-sm text-slate-600">
            Die Verfahrensdokumentation ist nur für Inhaber und Büro sichtbar.
          </p>
          <Link href="/einstellungen" className="mt-5 inline-block text-sm font-medium text-accent-700 hover:underline">
            Zurück zu Einstellungen
          </Link>
        </section>
      </main>
    );
  }
  const { tenantId } = context;
  const profile = await getWorkshopProfile(tenantId);
  const document = buildProcessDocumentation({
    companyName: profile?.companyName ?? 'Name des Betriebs',
    ownerName: profile?.ownerName ?? null,
    street: profile?.street ?? null,
    zip: profile?.zip ?? null,
    city: profile?.city ?? null,
    phone: profile?.phone ?? null,
    email: profile?.email ?? null,
    taxNumber: profile?.taxNumber ?? null,
    vatId: profile?.vatId ?? null,
    today: getDateStringInTimeZone(new Date(), INVOICE_TIME_ZONE),
  });
  const answers = await getProcessAnswers(tenantId);
  const fieldKeys = getProcessFieldKeys(document);
  const filledFields = fieldKeys.filter((key) => (answers[key] ?? '').trim() !== '').length;

  return (
    <main className="min-h-screen bg-slate-100 p-4 print:min-h-0 print:bg-white print:p-0">
      <article className="mx-auto max-w-[210mm] rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200 print:max-w-none print:rounded-none print:p-0 print:shadow-none print:ring-0">
        <nav className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link href="/einstellungen" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Zurück zu Einstellungen
          </Link>
          <PrintInvoiceButton />
        </nav>

        <p className="mb-6 rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-900 print:hidden">
          Dies ist eine Vorlage. Die Beschreibung des Systemverhaltens stammt aus WerkPilot; die {fieldKeys.length} gelben Felder
          kann nur der Betrieb ausfüllen. Du kannst direkt hineinschreiben: Die Antworten werden automatisch gespeichert und sind für
          Inhaber und Büro sichtbar. Bisher ausgefüllt: {filledFields} von {fieldKeys.length}. Zum Schluss drucken und mit der Freigabe der
          Steuerberatung ablegen.
        </p>

        <header className="border-b-2 border-slate-900 pb-6">
          <p className="text-sm font-medium text-slate-500">WerkPilot</p>
          <h1 className="mt-2 text-3xl font-medium tracking-tight text-slate-900">{document.title}</h1>
          <dl className="mt-5 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            {document.cover.map((entry) => (
              <div key={entry.label}>
                <dt className="text-xs text-slate-500">{entry.label}</dt>
                <dd className="font-medium text-slate-900">{entry.value}</dd>
              </div>
            ))}
          </dl>
        </header>

        {document.sections.map((section) => (
          <section key={section.id} className="mt-8 break-inside-auto" aria-labelledby={`h-${section.id}`}>
            <h2 id={`h-${section.id}`} className="border-b border-slate-300 pb-1 text-xl font-medium text-slate-900">
              {section.title}
            </h2>
            {section.blocks.map((block, index) => (
              <Block key={`${section.id}-${index}`} block={block} answers={answers} />
            ))}
          </section>
        ))}

        <footer className="mt-10 border-t border-slate-300 pt-4 text-xs text-slate-500">
          Verfahrensdokumentation {document.cover[0]?.value}, Stand {document.version}. Vorlage ohne Rechtsberatung; mit der Steuerberatung abstimmen.
        </footer>
      </article>
    </main>
  );
}
