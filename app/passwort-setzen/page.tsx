'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD_LENGTH, passwordUpdateErrorMessage, validateNewPassword } from '../../lib/staff-link';
import { createClient } from '../../lib/supabase/client';

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validateNewPassword(password, repeat);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    if (updateError) {
      setError(passwordUpdateErrorMessage(updateError));
      setSaving(false);
      return;
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-md rounded-3xl bg-white p-8 shadow-soft ring-1 ring-slate-200/80">
        <p className="text-sm font-medium text-slate-500">WerkPilot</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight text-slate-900">Passwort festlegen</h1>
        <p className="mt-2 text-sm text-slate-500">
          Willkommen! Wähle ein Passwort mit mindestens {MIN_PASSWORD_LENGTH} Zeichen für die Anmeldung.
        </p>

        {error && (
          <p role="alert" className="mt-5 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <label className="block text-sm font-medium text-slate-700">
            Neues Passwort
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/25"
              required
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Passwort wiederholen
            <input
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/25"
              required
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-accent-600/25 focus:ring-offset-2 disabled:opacity-60"
          >
            {saving ? 'Speichern …' : 'Passwort speichern'}
          </button>
        </form>
      </section>
    </main>
  );
}
