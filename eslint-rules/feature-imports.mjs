// Shared by the boundary rules: which feature a file sits in, and which feature an import reaches.
import path from 'node:path';

const FEATURE_DIR = /(?:^|\/)src\/features\/([^/]+)(?:\/|$)/;

/** The feature that holds a file, or null outside src/features. */
export function featureOfFile(filename) {
  return FEATURE_DIR.exec(filename.split(path.sep).join('/'))?.[1] ?? null;
}

/** The feature an import specifier lands in, or null when it lands elsewhere. */
export function featureOfImport(filename, specifier) {
  if (specifier.startsWith('@/features/')) return specifier.split('/')[2] || null;
  if (!specifier.startsWith('.')) return null;
  return featureOfFile(path.resolve(path.dirname(filename), specifier));
}

/** Calls check with every static, re-export and dynamic import source literal. */
export function importVisitors(check) {
  const visit = (node) => {
    const source = node.source;
    if (source?.type === 'Literal' && typeof source.value === 'string') check(source);
  };
  return {
    ImportDeclaration: visit,
    ExportNamedDeclaration: visit,
    ExportAllDeclaration: visit,
    ImportExpression: visit,
  };
}
