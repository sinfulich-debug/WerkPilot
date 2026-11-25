import Link from 'next/link';
import { signOut } from '../../lib/supabase/actions';

export default function NoWorkshopAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-soft ring-1 ring-slate-200/80">
        <p className="text-sm font-medium text-slate-500">WerkPilot</p>
        <h1 className="mt-4 text-2xl font-medium tracking-tight text-slate-900">Kein Werkstattzugang</h1>
        {/* The same page for "never added" and "deactivated": row-level security hides a deactivated
            member's own row, so the app cannot tell the two apart - the text fits both. */}
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Dein Konto hat derzeit keinen Zugang zu einer Werkstatt. Vielleicht wurde dein Zugang gesperrt oder du
          wurdest noch nicht eingeladen.
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Arbeitest du in einer Werkstatt? Dann wende dich bitte an den Inhaber. Ansonsten hilft dir unser Support weiter.
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Du bist Inhaber und möchtest WerkPilot für deine eigene Werkstatt nutzen?{' '}
          <Link href="/werkstatt-anlegen" className="font-medium text-accent-700 hover:underline">Werkstatt anlegen</Link>
        </p>
        <form action={signOut} className="mt-7">
          <button
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-accent-600/25 focus:ring-offset-2"
            type="submit"
          >
            Abmelden
          </button>
        </form>
      </section>
    </main>
  );
}
