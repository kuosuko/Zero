import * as Sentry from '@sentry/react';

const sentryDsn = import.meta.env.VITE_PUBLIC_SENTRY_DSN;

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    tunnel: import.meta.env.VITE_PUBLIC_BACKEND_URL + '/monitoring/sentry',
    integrations: [Sentry.replayIntegration()],
    tracesSampleRate: 1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    debug: false,
  });
}
