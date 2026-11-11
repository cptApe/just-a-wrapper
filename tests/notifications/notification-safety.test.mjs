// Notification content stays safe: untrusted text never becomes markup, feed links never leave the app, and codes never print in production.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emailLayout } from '../../src/features/notifications/lib/email-layout.ts';
import { feedPageSchema } from '../../src/features/notifications/lib/feed-schema.ts';
import { resolveCapabilities } from '../../src/lib/capabilities.ts';

test('text from users, titles and link queries stays text in the email', () => {
  const email = emailLayout({
    heading: '<img src=x>',
    lines: ['A & B'],
    button: { label: '"Join"', url: 'https://example.com/?a=1&b="x"' },
    footerReason: 'For <you>',
    supportEmail: 'help@acme.example',
  });
  assert.doesNotMatch(email.html, /<img/);
  assert.match(email.html, /&lt;img src=x&gt;/);
  assert.match(email.html, /a=1&amp;b=&quot;x&quot;/);
  assert.match(email.text, /A & B/);
});

test('a feed item keeps an in-app link and drops one that would leave the site, without failing the feed', () => {
  const linkOf = (link) =>
    feedPageSchema.parse({
      items: [
        {
          id: '1',
          kind: 'share.received',
          createdAt: 'now',
          readAt: null,
          data: { link, title: 'Shared' },
        },
      ],
      after: null,
      metadata: { totalCount: 1, unreadCount: 1, unseenCount: 1 },
    }).items[0].data.link;
  assert.equal(linkOf('/app/library'), '/app/library');
  for (const link of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', 7])
    assert.equal(linkOf(link), undefined, String(link));
});

test('sign-in codes print to the console only in development; a build without an email key sends nothing', () => {
  assert.deepEqual(resolveCapabilities({ NODE_ENV: 'development' }).email, { kind: 'console' });
  for (const NODE_ENV of ['production', 'test'])
    assert.deepEqual(resolveCapabilities({ NODE_ENV }).email, { kind: 'off' });
  assert.deepEqual(resolveCapabilities({ NODE_ENV: 'production', RESEND_API_KEY: 'key' }).email, {
    kind: 'resend',
    apiKey: 'key',
  });
});
