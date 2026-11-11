// Links and images the app follows on someone's behalf stay on this origin, so a tool result or
// a chat message cannot send a person elsewhere or leak data through an image request.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageContentSecurityPolicy } from '../../src/lib/image-csp.ts';
import { isTrustedMarkdownImage } from '../../src/lib/markdown-image-source.ts';
import { isSafeInternalHref } from '../../src/lib/safe-internal-href.ts';

test('tool navigation accepts only a single-slash path on this origin', () => {
  assert.equal(isSafeInternalHref('/app/task/1'), true);
  for (const href of [
    '//evil.example/task',
    'https://evil.example/task',
    'app/task/1',
    '/\\evil.example',
    '/\\/evil.example',
    '/\t/evil.example',
    '//[',
  ]) {
    assert.equal(isSafeInternalHref(href), false, href);
  }
});

test('markdown loads images only from the app file routes, never a URL that could carry data out', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const path of [`/api/files/${id}/content`, `/api/artifacts/${id}/content?share=token`])
    assert.equal(isTrustedMarkdownImage(path), true, path);
  for (const path of [
    'https://evil.example/p?secret=private',
    '//evil.example/p',
    '/ingest/secret',
    'data:image/svg+xml,test',
    'javascript:alert(1)',
    `/api/files/${id}/content/../../redirect`,
    `/api/files/${id}/content\\evil`,
  ])
    assert.equal(isTrustedMarkdownImage(path), false, path);
});

test('the image policy allows this deployment store only and never prints the Blob token', () => {
  const policy = imageContentSecurityPolicy('vercel_blob_rw_OurStore_secret');
  assert.match(policy, /https:\/\/ourstore\.private\.blob\.vercel-storage\.com/);
  assert.equal(policy.includes('https://*.private.blob'), false);
  assert.equal(policy.includes('public.blob'), false);
  assert.equal(policy.includes('secret'), false);
  assert.equal(imageContentSecurityPolicy(undefined).includes('blob.vercel-storage.com'), false);
  assert.throws(() => imageContentSecurityPolicy('invalid-secret'), {
    message: 'BLOB_READ_WRITE_TOKEN has no valid store ID.',
  });
});
