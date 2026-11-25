import Link from 'next/link';
import Sidebar from '../../../components/Sidebar';
import { actorLabel, describeAuditEntry, NO_MEMBER_NAMES, type MemberNames } from '../../../lib/audit-log';
import { AUDIT_ENTITIES, getAuditLog, getMemberNames, type AuditEntity } from '../../../lib/db/audit';
import { INVOICE_TIME_ZONE } from '../../../lib/date';
import { ForbiddenError, requireRole } from '../../../lib/requireRole';

const ENTITY_LABEL: Record<AuditEntity, string> = {
  invoices: 'Rechnungen',
  payments: 'Zahlungen',
  work_orders: 'Aufträge',
  stock_movements: 'Lager',
  tenant_members: 'Mitarbeiter',
};

/** Names are a nice-to-have: without migration 0021 (or on any error) the log still works and shows "Mitarbeiter". */
async function loadMemberNames(tenantId: string): Promise<MemberNames> {
  try {
    return await getMemberNames(tenantId);
  } catch (error) {
    console.error('Mitarbeiternamen für das Änderungsprotokoll konnten nicht geladen werden.', error);
    return NO_MEMBER_NAMES;
  }
}

const timeFormat = new Intl.DateTimeFormat('de-DE', {
  timeZone: INVOICE_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function parseEntity(value: string | string[] | undefined): AuditEntity | undefined {
  return AUDIT_ENTITIES.find((entity) => entity === value);
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: { entity?: string | string[] };
}) {
  // Only owner and office may read the log; the database enforces the same rule.
  let context;
  try {
    context = await requireRole(['owner', 'office']);
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error;
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <section className="max-w-md rounded-3xl bg-white p-8 text-center shadow-soft ring-1 ring-slate-200/80">
          <h1 className="text-xl font-medium text-slate-900">Änderungsprotokoll</h1>
          <p role="alert" className="mt-3 text-sm text-slate-600">
            Das Änderungsprotokoll ist nur für Inhaber und Büro sichtbar.
          </p>
          <Link href="/finanzen" className="mt-5 inline-block text-sm font-medium text-accent-700 hover:underline">
            Zurück zu Finanzen
          </Link>
        </section>
      </main>
    );
  }
  const { tenantId, userId } = context;
  const entity = parseEntity(searchParams.entity);
  const [entries, names] = await Promise.all([getAuditLog(tenantId, { entity, limit: 200 }), loadMemberNames(tenantId)]);

  return (
    <div className="min-h-screen bg-slate-100 md:h-screen md:overflow-hidden">
      <div className="flex flex-col md:h-full md:flex-row">
        <Sidebar />
        <main className="wp-stagger min-w-0 flex-1 bg-slate-50 px-4 py-6 md:h-full md:overflow-y-auto lg:px-10 lg:py-8">
          <header className="border-b border-slate-200 pb-6">
            <Link href="/finanzen" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              ← Zurück zu Finanzen
            </Link>
            <h1 className="mt-3 text-3xl font-medium tracking-tight text-slate-900">Änderungsprotokoll</h1>
            <p className="mt-1 text-sm text-slate-500">
              Jede Änderung an Rechnungen, Zahlungen, Aufträgen, Lagerbewegungen und Mitarbeitern wird automatisch festgehalten. Einträge
              können nicht geändert oder gelöscht werden.
            </p>
          </header>

          <nav className="mt-5 flex flex-wrap gap-2" aria-label="Filter">
            <Link
              href="/finanzen/protokoll"
              aria-current={entity === undefined ? 'page' : undefined}
              className={`rounded-xl px-3 py-2 text-sm font-medium ${entity === undefined ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`}
            >
              Alle
            </Link>
            {AUDIT_ENTITIES.map((item) => (
              <Link
                key={item}
                href={`/finanzen/protokoll?entity=${item}`}
                aria-current={entity === item ? 'page' : undefined}
                className={`rounded-xl px-3 py-2 text-sm font-medium ${entity === item ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`}
              >
                {ENTITY_LABEL[item]}
              </Link>
            ))}
          </nav>

          {entries.length === 0 ? (
            <p className="mt-6 rounded-2xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200">
              Noch keine Einträge. Sobald eine Rechnung, Zahlung, ein Auftrag oder eine Lagerbewegung angelegt oder geändert wird, erscheint sie hier.
            </p>
          ) : (
            <div className="mt-6 overflow-x-auto rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="px-4 py-3 font-medium">Zeitpunkt</th>
                    <th className="px-4 py-3 font-medium">Was ist passiert</th>
                    <th className="px-4 py-3 font-medium">Bereich</th>
                    <th className="px-4 py-3 font-medium">Durch</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const description = describeAuditEntry(entry, names);
                    const knownEntity = AUDIT_ENTITIES.find((item) => item === entry.entity);
                    return (
                      <tr key={entry.id} className="border-b border-slate-100 align-top last:border-0">
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">
                          {timeFormat.format(new Date(entry.createdAt))}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{description.title}</p>
                          {description.detail && <p className="text-xs text-slate-500">{description.detail}</p>}
                        </td>
                        <td className="px-4 py-3 text-slate-600" title={entry.entityId}>
                          {knownEntity ? ENTITY_LABEL[knownEntity] : entry.entity}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {actorLabel(entry.userId, userId, names)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
