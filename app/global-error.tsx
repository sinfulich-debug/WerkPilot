'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

// Last safety net: an error that broke the whole layout. Reports it (scrubbed, see lib/sentry-scrub.ts)
// and shows a plain German message with a way to try again.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="de">
      <body className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-medium text-slate-900">Etwas ist schiefgelaufen</h1>
          <p className="mt-2 text-sm text-slate-600">Der Fehler wurde gemeldet. Bitte versuchen Sie es erneut.</p>
          <button type="button" onClick={reset} className="mt-6 rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Erneut versuchen
          </button>
        </div>
      </body>
    </html>
  );
}
