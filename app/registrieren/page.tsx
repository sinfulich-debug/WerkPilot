import Link from 'next/link';
import type { Metadata } from 'next';
import { signUp } from '../../lib/registration-actions';
import { registrationErrorMessage, WORKSHOP_NAME_MAX } from '../../lib/registration';
import { MIN_PASSWORD_LENGTH } from '../../lib/staff-link';

export const metadata: Metadata = { title: 'WerkPilot | Registrieren' };

type Props = { searchParams: { error?: string; sent?: string } };

const inputClass =
  'mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-slate-900 outline-none transition focus:border-accent-600 focus:bg-white';

export default function RegisterPage({ searchParams }: Props) {
  const error = registrationErrorMessage(searchParams.error);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-md rounded-3xl bg-white p-8 shadow-soft ring-1 ring-slate-200/80">
        <div className="mb-8">
          <p className="text-sm font-medium text-slate-500">WerkPilot</p>
          <h1 className="mt-3 text-3xl font-medium tracking-tight text-slate-900">Werkstatt registrieren</h1>
          <p className="mt-2 text-sm text-slate-500">Lege ein Konto für deine Werkstatt an. Du wirst Inhaber.</p>
        </div>

        {searchParams.sent === '1' ? (
          <div role="status" className="rounded-2xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-800">
            Fast geschafft! Wir haben dir eine E-Mail geschickt. Öffne den Link darin in diesem Browser, um deine
            E-Mail-Adresse zu bestätigen und die Werkstatt anzulegen.
          </div>
        ) : (
          <>
            {error && (
              <p role="alert" className="mb-5 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
            )}
            <form action={signUp} className="space-y-5">
              <label className="block text-sm font-medium text-slate-700">
                Name der Werkstatt
                <input className={inputClass} name="workshopName" required minLength={2} maxLength={WORKSHOP_NAME_MAX} autoComplete="organization" />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                E-Mail
                <input className={inputClass} name="email" required type="email" autoComplete="email" />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Passwort
                <input className={inputClass} name="password" required type="password" minLength={MIN_PASSWORD_LENGTH} maxLength={72} autoComplete="new-password" />
                <span className="mt-1 block text-xs font-normal text-slate-500">Mindestens {MIN_PASSWORD_LENGTH} Zeichen.</span>
              </label>
              <label className="flex items-start gap-3 text-sm text-slate-600">
                <input name="terms" type="checkbox" required className="mt-1 h-4 w-4 rounded border-slate-300" />
                <span>
                  Ich akzeptiere die{' '}
                  <Link href="/agb" className="font-medium text-accent-700 hover:underline" target="_blank">AGB</Link>{' '}
                  und habe die{' '}
                  <Link href="/datenschutz" className="font-medium text-accent-700 hover:underline" target="_blank">Datenschutzerklärung</Link>{' '}
                  gelesen.
                </span>
              </label>
              <button
                className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-accent-600/25 focus:ring-offset-2"
                type="submit"
              >
                Konto anlegen
              </button>
            </form>
          </>
        )}

        <p className="mt-6 text-center text-sm text-slate-500">
          Schon registriert? <Link href="/login" className="font-medium text-accent-700 hover:underline">Anmelden</Link>
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
