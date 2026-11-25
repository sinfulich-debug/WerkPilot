import Link from 'next/link';
import Sidebar from '../../../components/Sidebar';
import StaffManager from '../../../components/StaffManager';
import { ForbiddenError, requireRole } from '../../../lib/requireRole';

export default async function StaffPage() {
  let allowed = true;
  try {
    await requireRole(['owner']);
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error;
    allowed = false;
  }

  return (
    <div className="min-h-screen bg-slate-100 md:h-screen md:overflow-hidden">
      <div className="flex flex-col md:h-full md:flex-row">
        <Sidebar />
        <main className="wp-stagger min-w-0 flex-1 bg-slate-50 px-4 py-6 md:h-full md:overflow-y-auto lg:px-10 lg:py-8">
          <header className="border-b border-slate-200 pb-6">
            <Link href="/einstellungen" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              Zurück zu Einstellungen
            </Link>
            <h1 className="mt-3 text-3xl font-medium tracking-tight text-slate-900">Mitarbeiter</h1>
            <p className="mt-1 text-sm text-slate-500">Mitarbeiter einladen, Rollen ändern und Zugänge sperren</p>
          </header>
          <div className="mt-6">
            {allowed ? (
              <StaffManager />
            ) : (
              <p role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
                Nur der Inhaber der Werkstatt darf Mitarbeiter verwalten.
              </p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
