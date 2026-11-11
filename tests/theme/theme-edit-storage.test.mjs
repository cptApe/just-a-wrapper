import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const STORAGE_KEY = 'admin:theme-edit';
const values = new Map();
const storageListeners = new Set();

globalThis.window = {
  localStorage: {
    getItem(key) {
      return values.get(key) ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  },
  addEventListener(type, listener) {
    if (type === 'storage') storageListeners.add(listener);
  },
  removeEventListener(type, listener) {
    if (type === 'storage') storageListeners.delete(listener);
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/observability-client') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export function captureException() {}',
      };
    }
    if (specifier === './theme-values') {
      return { shortCircuit: true, url: new URL('./theme-values.ts', context.parentURL).href };
    }
    return nextResolve(specifier, context);
  },
});

const { activateThemeEdit, deactivateThemeEdit, readThemeEditState, subscribeThemeEditState } =
  await import('../../src/features/theme/lib/theme-edit-storage.ts');

const unsubscribe = subscribeThemeEditState(() => {});

function announceStorageChange() {
  for (const listener of storageListeners) listener({ key: STORAGE_KEY });
}

test('an untouched edit session leaves no phantom persisted draft', () => {
  activateThemeEdit();
  assert.equal(JSON.parse(values.get(STORAGE_KEY)).active, true);

  deactivateThemeEdit();

  assert.equal(values.has(STORAGE_KEY), false);
  assert.deepEqual(readThemeEditState(), {
    active: false,
    light: {},
    dark: {},
  });
});

test('an unsaved theme draft from the older format keeps its colours', () => {
  values.set(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      active: false,
      light: { '--accent': 'hsl(45 90% 88%)' },
      dark: {},
    }),
  );
  announceStorageChange();

  assert.equal('manual' in readThemeEditState(), false);
  activateThemeEdit();

  assert.deepEqual(JSON.parse(values.get(STORAGE_KEY)), {
    version: 2,
    active: true,
    light: { '--accent': 'hsl(45 90% 88%)' },
    dark: {},
  });
});

test.after(() => {
  unsubscribe();
  delete globalThis.window;
});

test('a current draft with leftover metadata keeps its colours', () => {
  values.set(
    STORAGE_KEY,
    JSON.stringify({
      version: 2,
      active: true,
      light: { '--accent': 'red' },
      dark: {},
      manual: { light: ['--accent'] },
    }),
  );
  announceStorageChange();
  assert.deepEqual(readThemeEditState(), { active: true, light: { '--accent': 'red' }, dark: {} });
});
