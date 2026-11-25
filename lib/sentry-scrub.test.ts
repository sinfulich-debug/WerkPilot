import { describe, expect, it } from 'vitest';
import { redactApprovalTokens, scrubBreadcrumb, scrubEvent, scrubUrl, sentryOptions } from './sentry-scrub';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

describe('sentry privacy filter', () => {
  it('removes approval tokens from paths and API addresses', () => {
    expect(redactApprovalTokens(`GET /freigabe/${TOKEN}/api failed`)).toBe('GET /freigabe/[token]/api failed');
    expect(scrubUrl(`https://app.example/freigabe/${TOKEN}?x=1#y`)).toBe('https://app.example/freigabe/[token]');
  });

  it('strips request details, the user and every token in an event', () => {
    const event = scrubEvent({
      message: `boom at /freigabe/${TOKEN}`,
      transaction: `GET /freigabe/${TOKEN}/api`,
      request: { url: `https://app.example/freigabe/${TOKEN}/api?a=b`, query_string: 'a=b', cookies: { sb: 'x' }, headers: { authorization: 'y' }, data: '{"signerName":"Anna"}' },
      user: { ip_address: '203.0.113.7' },
      exception: { values: [{ value: `fetch /freigabe/${TOKEN}/api`, stacktrace: { frames: [{ filename: `app:///freigabe/${TOKEN}/page.js` }] } }] },
      breadcrumbs: [{ message: 'nav', data: { from: `/freigabe/${TOKEN}`, to: '/kunden?q=Anna' } }],
      tags: { url: `/freigabe/${TOKEN}` },
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('203.0.113.7');
    expect(text).not.toContain('Anna');
    expect(event.request).toEqual({ url: 'https://app.example/freigabe/[token]/api' });
    expect(event.user).toBeUndefined();
  });

  it('cleans breadcrumbs recorded in the browser', () => {
    const crumb = scrubBreadcrumb({ data: { url: `/freigabe/${TOKEN}/api?x=1` } });
    expect(crumb.data?.url).toBe('/freigabe/[token]/api');
  });

  it('stays off without a DSN and never sends personal data by default', () => {
    expect(sentryOptions(undefined).enabled).toBe(false);
    const on = sentryOptions('https://key@o1.ingest.de.sentry.io/1');
    expect(on.enabled).toBe(true);
    expect(on.sendDefaultPii).toBe(false);
    expect(on.tracesSampleRate).toBe(0);
  });
});
