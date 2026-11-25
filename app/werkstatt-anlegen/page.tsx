import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createWorkshop } from '../../lib/registration-actions';
import { registrationErrorMessage, WORKSHOP_NAME_MAX } from '../../lib/registration';
import { getSessionContext, NotAuthenticatedError, NoTenantError } from '../../lib/session';
import { signOut } from '../../lib/supabase/actions';
import { createClient } from '../../lib/supabase/server';

export const metadata: Metadata = { title: 'WerkPilot | Werkstatt anlegen' };

type Props = { searchParams: { error?: string } };

/** Second step of the registration: the e-mail is confirmed, now the workshop is created. */
export default async function CreateWorkshopPage({ searchParams }: Props) {
  try {
    await getSessionContext();
    redirect('/'); // already belongs to a workshop
  } catch (error) {
    if (error instanceof NotAuthenticatedError) redirect('/login?error=session');
    if (!(error instanceof NoTenantError)) throw error;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const suggested = typeof user?.user_metadata?.workshop_name === 'string' ? user.user_metadata.workshop_name : '';
  const error = registrationErrorMessage(searchParams.error);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-md rounded-3xl bg-white p-8 shadow-soft ring-1 ring-slate-200/80">
        <p className="text-sm font-medium text-slate-500">WerkPilot</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight text-slate-900">Werkstatt anlegen</h1>
        <p className="mt-2 text-sm text-slate-500">
          Deine E-Mail-Adresse ist bestätigt. Prüfe den Namen deiner Werkstatt, Adresse und Steuerdaten trägst du
          danach in den Einstellungen ein.
        </p>

        {error && <p role="alert" className="mt-5 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

        <form action={createWorkshop} className="mt-6 space-y-5">
          <label className="block text-sm font-medium text-slate-700">
            Name der Werkstatt
            <input
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
              name="workshopName"
              defaultValue={suggested}
              required
              minLength={2}
              maxLength={WORKSHOP_NAME_MAX}
            />
          </label>
          <button
            className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-accent-600/25 focus:ring-offset-2"
            type="submit"
          >
            Werkstatt anlegen
          </button>
        </form>

        <form action={signOut} className="mt-4 text-center">
          <button type="submit" className="text-sm text-slate-500 hover:text-slate-700 hover:underline">Abmelden</button>
        </form>
      </section>
    </main>
  );
}
