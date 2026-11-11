// Incoming webhooks: only a fresh delivery signed with our secret over the exact body is accepted.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  signAnthropicWebhook,
  verifyAnthropicWebhook,
} from '../../src/features/webhooks/anthropic-verify.ts';
import {
  signComposioWebhook,
  verifyComposioWebhook,
} from '../../src/features/webhooks/composio-verify.ts';

const minutes = (count) => new Date(Date.now() + count * 60_000);

for (const [provider, sign, verify, secret, other, event, accepted] of [
  [
    'Anthropic',
    signAnthropicWebhook,
    verifyAnthropicWebhook,
    `whsec_${Buffer.from('just-a-wrapper-test-signing-key-bytes').toString('base64')}`,
    `whsec_${Buffer.from('a-completely-different-secret-key').toString('base64')}`,
    { id: 'evt_123', type: 'event', data: { type: 'session.status_idled', id: 'sess_abc' } },
    (event) => event,
  ],
  [
    'Composio',
    signComposioWebhook,
    verifyComposioWebhook,
    'composio-dashboard-webhook-secret',
    'a-completely-different-secret',
    { id: 'msg_abc123', type: 'composio.trigger.message', data: { subject: 'hello' } },
    (event) => ({ id: 'evt_123', payload: event }),
  ],
]) {
  test(`${provider}: a forged, altered, replayed or unsigned delivery is refused`, () => {
    const body = JSON.stringify(event);
    assert.deepEqual(
      verify(body, sign('evt_123', body, secret, new Date()), secret),
      accepted(event),
    );
    const tampered = sign('evt_123', body, secret, new Date());
    tampered['webhook-signature'] = `${tampered['webhook-signature'].slice(0, -4)}AAAA`;
    for (const [name, deliveredBody, headers] of [
      ['tampered signature', body, tampered],
      ['other secret', body, sign('evt_123', body, other, new Date())],
      ['altered body', `${body} `, sign('evt_123', body, secret, new Date())],
      ['replayed 10 minutes later', body, sign('evt_123', body, secret, minutes(-10))],
      ['dated 10 minutes ahead', body, sign('evt_123', body, secret, minutes(10))],
      ['no signature', body, {}],
    ])
      assert.throws(() => verify(deliveredBody, headers, secret), undefined, name);
  });
}
