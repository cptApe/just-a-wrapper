import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { home } from '../../content/home.ts';
import { brand } from '../../src/lib/brand/identity.ts';
import { loadTsx } from '../support/load-tsx.mjs';

const require = createRequire(import.meta.url);
let session = null;

function resolveLanding(name) {
  if (name === '@/lib/brand/identity') return { brand };
  if (name === '@content/home') return { home };
  if (name === 'next/link') {
    const { createElement } = require('react');
    return function Link(props) {
      return createElement('a', props);
    };
  }
  if (name === '@/components/brand/logo') return { Logo: () => brand.name };
  if (name === '@/components/icons') return new Proxy({}, { get: () => () => null });
  if (
    name.startsWith('@/components/ui/') ||
    name.startsWith('@/features/chat/components/') ||
    name.startsWith('@/features/files/components/')
  ) {
    return new Proxy(
      {},
      {
        get:
          () =>
          ({ children }) =>
            children ?? null,
      },
    );
  }
  if (name === '@/lib/utils') return { cn: (...parts) => parts.filter(Boolean).join(' ') };
  if (name === '@/features/shell/lib/nav') {
    return loadTsx('src/features/shell/lib/nav.ts', resolveLanding);
  }
  if (name === '@/features/chat/lib/composer-geometry') {
    return loadTsx('src/features/chat/lib/composer-geometry.ts', resolveLanding);
  }
  if (name === '../lib/shell-tokens') {
    return loadTsx('src/features/landing/lib/shell-tokens.ts', resolveLanding);
  }
  if (name.startsWith('./')) {
    const stem = `src/features/landing/components/${name.slice(2)}`;
    return loadTsx(existsSync(`${stem}.ts`) ? `${stem}.ts` : `${stem}.tsx`, resolveLanding);
  }
  return require(name);
}

const { default: HomePage } = loadTsx('src/app/page.tsx', (name) => {
  if (name === 'next/navigation') {
    return {
      redirect(path) {
        throw new Error(`redirect:${path}`);
      },
    };
  }
  if (name === '@/lib/request-session') return { getRequestSession: async () => session };
  if (name === '@/features/landing') {
    return loadTsx('src/features/landing/components/home-landing.tsx', resolveLanding);
  }
  return require(name);
});

it('a signed-out visitor gets the home page with a way to sign in', async () => {
  session = null;
  const html = renderToStaticMarkup(await HomePage());
  assert.ok(html.includes('href="/login"'));
});

it('a signed-in visitor goes straight to the app', async () => {
  session = { user: { id: 'user-1' } };
  await assert.rejects(HomePage(), /redirect:\/app/);
});
