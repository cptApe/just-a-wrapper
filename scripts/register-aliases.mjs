import { existsSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const contentRootUrl = new URL('../content/', import.meta.url);
const contentExtensions = ['', '.ts', '.tsx', '.js', '.mjs', '.json'];
const sourceRootUrl = new URL('../src/', import.meta.url);
const sourceExtensions = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx'];

function isFile(url) {
  const path = fileURLToPath(url);
  return existsSync(path) && statSync(path).isFile();
}

function resolveContentAlias(specifier) {
  const relativePath = specifier.slice('@content/'.length);
  for (const extension of contentExtensions) {
    const candidate = new URL(`${relativePath}${extension}`, contentRootUrl);
    if (existsSync(fileURLToPath(candidate))) return candidate.href;
  }
  throw new Error(
    `Import alias "${specifier}" did not resolve under content/. Check the path or add its extension to scripts/register-aliases.mjs.`,
  );
}

function resolveSourceAlias(specifier) {
  const relativePath = specifier.slice('@/'.length);
  for (const extension of sourceExtensions) {
    const candidate = new URL(`${relativePath}${extension}`, sourceRootUrl);
    if (isFile(candidate)) return candidate.href;
  }
  throw new Error(`Import alias "${specifier}" did not resolve under src/.`);
}

function resolveExtensionlessFile(specifier) {
  if (!specifier.startsWith('file:')) return null;
  for (const extension of sourceExtensions.slice(1)) {
    const candidate = new URL(`${specifier}${extension}`);
    if (isFile(candidate)) return candidate.href;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true };
    }
    // next's package exports have no extensionless "server" entry for plain Node.
    if (specifier === 'next/server') return nextResolve('next/server.js', context);
    if (specifier.startsWith('@content/')) {
      return { shortCircuit: true, url: resolveContentAlias(specifier) };
    }
    if (specifier.startsWith('@/')) {
      return { shortCircuit: true, url: resolveSourceAlias(specifier) };
    }
    const fileUrl = resolveExtensionlessFile(specifier);
    if (fileUrl) return { shortCircuit: true, url: fileUrl };
    if (specifier.startsWith('.') && context.parentURL) {
      const relativeUrl = resolveExtensionlessFile(new URL(specifier, context.parentURL).href);
      if (relativeUrl) return { shortCircuit: true, url: relativeUrl };
    }
    return nextResolve(specifier, context);
  },
});
