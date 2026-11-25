import Link from 'next/link';
import { signIn } from '../../lib/supabase/actions';

type LoginPageProps = {
  searchParams: { error?: string };
};

export default function LoginPage({ searchParams }: LoginPageProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-md rounded-3xl bg-white p-8 shadow-soft ring-1 ring-slate-200/80">
        <div className="mb-8">
          <p className="text-sm font-medium text-slate-500">WerkPilot</p>
          <h1 className="mt-3 text-3xl font-medium tracking-tight text-slate-900">Anmelden</h1>
          <p className="mt-2 text-sm text-slate-500">Melde dich bei deinem Werkstattkonto an.</p>
        </div>

        {searchParams.error === 'credentials' && (
          <p role="alert" className="mb-5 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">
            E-Mail oder Passwort ist falsch
          </p>
        )}

        {searchParams.error === 'link' && (
          <p role="alert" className="mb-5 rounded-2xl bg-amber-50 p-3 text-sm text-amber-700">
            Der Link ist abgelaufen oder wurde schon benutzt. Mitarbeiter bekommen beim Inhaber einen neuen Link;
            nach einer Registrierung einfach hier anmelden.
          </p>
        )}

        {searchParams.error === 'session' && (
          <p role="alert" className="mb-5 rounded-2xl bg-amber-50 p-3 text-sm text-amber-700">
            Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.
          </p>
        )}

        {searchParams.error === 'database' && (
          <p role="alert" className="mb-5 rounded-2xl bg-amber-50 p-3 text-sm text-amber-700">
            Die Datenbank ist derzeit nicht erreichbar. Bitte versuche es später erneut.
          </p>
        )}

        <form action={signIn} className="space-y-5">
          <label className="block text-sm font-medium text-slate-700">
            E-Mail
            <input
              autoComplete="email"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
              name="email"
              required
              type="email"
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Passwort
            <input
              autoComplete="current-password"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white"
              name="password"
              required
              type="password"
            />
          </label>

          <button
            className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-accent-600/25 focus:ring-offset-2"
            type="submit"
          >
            Anmelden
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Neu bei WerkPilot? <Link href="/registrieren" className="font-medium text-accent-700 hover:underline">Werkstatt registrieren</Link>
        </p>
        <p className="mt-4 flex justify-center gap-4 text-xs text-slate-400">
          <Link href="/impressum" className="hover:underline">Impressum</Link>
          <Link href="/datenschutz" className="hover:underline">Datenschutz</Link>
          <Link href="/agb" className="hover:underline">AGB</Link>
        </p>
      </section>
    </main>
  );
}
