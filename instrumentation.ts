import * as Sentry from '@sentry/nextjs';

// Loads the Sentry setup for the runtime the code runs in (Node.js server or edge middleware).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./sentry.server.config');
  if (process.env.NEXT_RUNTIME === 'edge') await import('./sentry.edge.config');
}

export const onRequestError = Sentry.captureRequestError;
