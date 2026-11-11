import assert from 'node:assert/strict';
import { it } from 'node:test';
import nextTesting from 'next/dist/experimental/testing/server/middleware-testing-utils.js';
import { NextRequest, NextResponse } from 'next/server';
import { imageContentSecurityPolicy } from '../../src/lib/image-csp.ts';
import { loadTsx } from '../support/load-tsx.mjs';

const environment = { BLOB_READ_WRITE_TOKEN: undefined };
const { proxy, config } = loadTsx('src/proxy.ts', (name) => {
  if (name === 'next/server') return { NextResponse };
  if (name === '@/lib/env') return { env: environment };
  if (name === '@/lib/image-csp') return { imageContentSecurityPolicy };
  if (name === '@/features/auth/lib/return-to') return { PATHNAME_HEADER: 'x-pathname' };
  throw new Error(name);
});

it('pages may load images from the configured Blob store, and sign-in keeps the return path', () => {
  const request = new NextRequest('https://app.example/upgrade?plan=pro');
  assert.equal(
    proxy(request).headers.get('Content-Security-Policy').includes('blob.vercel-storage.com'),
    false,
  );
  environment.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_RuntimeStore_secret';
  const response = proxy(request);
  assert.match(
    response.headers.get('Content-Security-Policy'),
    /runtimestore.private.blob.vercel-storage.com/,
  );
  assert.equal(response.headers.get('x-middleware-request-x-pathname'), '/upgrade?plan=pro');
});

it('the proxy runs on pages and never on analytics ingestion, API routes or static files', () => {
  for (const url of ['/ingest', '/ingest/batch', '/api/sessions', '/_next/static/app.js']) {
    assert.equal(nextTesting.unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }), false);
  }
  for (const url of ['/', '/login', '/app/settings']) {
    assert.equal(nextTesting.unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }), true);
  }
});
