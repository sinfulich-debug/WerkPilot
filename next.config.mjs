import { withSentryConfig } from '@sentry/nextjs/config';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Next 14 runs instrumentation.ts (Sentry setup) only with this flag.
    instrumentationHook: true,
    // pdfkit reads its color profile from its own folder; bundled, that path no longer exists.
    serverComponentsExternalPackages: ['pdfkit'],
    // Files read at runtime by the ZUGFeRD PDF export must be shipped with the route in a production build.
    outputFileTracingIncludes: {
      '/finanzen/[id]/einvoice': ['./assets/fonts/**/*', './node_modules/pdfkit/js/data/**/*'],
    },
  },
};

// Source maps are uploaded only when SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are set (on Vercel).
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN, deleteSourcemapsAfterUpload: true },
});
