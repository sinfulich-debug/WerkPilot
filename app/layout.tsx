import './globals.css';
import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { billingAccess, isOpenWhenLocked } from '../lib/billing';
import { getBillingState } from '../lib/db/billing';
import { needsWorkshop } from '../lib/public-paths';
import { getSessionContext, isDatabaseConnectionError, NoTenantError, NotAuthenticatedError, type SessionContext } from '../lib/session';
import { getBillingConfig } from '../lib/stripe';

const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-sans', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'WerkPilot | Dashboard',
  description: 'Dashboard für Kfz-Werkstätten',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = headers().get('x-werkpilot-pathname');
  // Public pages and the pages for accounts without a workshop are skipped (lib/public-paths.ts).
  if (pathname && needsWorkshop(pathname)) {
    let context: SessionContext;
    try {
      context = await getSessionContext();
    } catch (error) {
      // order matters: NotAuthenticatedError is also a NoTenantError
      if (error instanceof NotAuthenticatedError) redirect('/login?error=session');
      if (error instanceof NoTenantError) redirect('/kein-zugang');
      if (isDatabaseConnectionError(error)) redirect('/login?error=database');
      throw error;
    }
    // After the trial without a working subscription only the subscription page opens. Only while
    // Stripe is configured; workshops without a billing row (pilot) are never locked.
    if (getBillingConfig() && !isOpenWhenLocked(pathname)) {
      const access = billingAccess(await getBillingState(context), new Date());
      if (access === 'expired') redirect('/abo');
    }
  }

  return (
    <html lang="de" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
