/** Model browser history with a real entry stack and asynchronous popstate.
 * Overlay Close must return to the page without exposing another panel. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  closeOverlay,
  openOverlay,
  preventOverlayClose,
  readOverlayHash,
  subscribeOverlayHash,
  syncOverlayHash,
} from '../../src/features/overlays/lib/overlay-history.ts';

function createFakeWindow(urls, startIndex = urls.length - 1) {
  const entries = [...urls];
  let index = startIndex;
  const listeners = new Map();
  const dispatch = (type) => {
    for (const listener of listeners.get(type) ?? []) listener(new Event(type));
  };
  const location = {
    get href() {
      return entries[index];
    },
    get hash() {
      return new URL(entries[index]).hash;
    },
  };
  const history = {
    pushState(_state, _title, url) {
      entries.splice(index + 1);
      entries.push(String(url));
      index += 1;
    },
    replaceState(_state, _title, url) {
      entries[index] = String(url);
    },
    back() {
      if (index === 0) return;
      index -= 1;
      queueMicrotask(() => dispatch('popstate'));
    },
    forward() {
      if (index === entries.length - 1) return;
      index += 1;
      queueMicrotask(() => dispatch('popstate'));
    },
  };
  const fakeWindow = {
    location,
    history,
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
      );
    },
    dispatchEvent(event) {
      dispatch(event.type);
      return true;
    },
  };
  return {
    install() {
      globalThis.window = fakeWindow;
    },
    entries: () => entries.slice(),
    index: () => index,
    href: () => entries[index],
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function watch() {
  const seen = [];
  const unsubscribe = subscribeOverlayHash((hash) => seen.push(hash));
  return { seen, unsubscribe };
}

// Each test leaves the module's traversal state reset: the overlay is closed
// through a popstate or from a cold link, so the next test starts clean.

test('switching overlays then closing once lands on the page, not on an earlier overlay', async () => {
  const fake = createFakeWindow(['https://app.test/app/library']);
  fake.install();
  const { seen, unsubscribe } = watch();

  openOverlay('file/A');
  openOverlay('file/B');
  openOverlay('file/A');

  assert.equal(readOverlayHash(), 'file/A');
  assert.equal(fake.entries().length, 2, 'the three opens share one history entry');

  closeOverlay();
  await settle();

  assert.equal(readOverlayHash(), '');
  assert.equal(fake.href(), 'https://app.test/app/library');
  assert.deepEqual(seen, ['file/A', 'file/B', 'file/A', '']);
  unsubscribe();
});

test('pressing Close several times fast leaves the overlay, not the page', async () => {
  const fake = createFakeWindow(['https://app.test/app', 'https://app.test/app/library']);
  fake.install();
  const { unsubscribe } = watch();

  openOverlay('file/A');
  closeOverlay();
  closeOverlay();
  closeOverlay();
  await settle();

  assert.equal(fake.href(), 'https://app.test/app/library');
  assert.equal(readOverlayHash(), '');
  unsubscribe();
});

test('closing an overlay opened from a link stays on the page instead of leaving the app', () => {
  const fake = createFakeWindow(['https://app.test/app/library#file/A']);
  fake.install();
  const { seen, unsubscribe } = watch();

  closeOverlay();

  assert.equal(fake.href(), 'https://app.test/app/library');
  assert.equal(fake.entries().length, 1);
  assert.deepEqual(seen, ['']);
  unsubscribe();
});

test('an overlay opened over a linked overlay still closes onto the page', () => {
  const fake = createFakeWindow(['https://app.test/app/library#file/A']);
  fake.install();
  const { unsubscribe } = watch();

  openOverlay('file/B');
  assert.equal(readOverlayHash(), 'file/B');
  assert.equal(fake.entries().length, 1);

  closeOverlay();
  assert.equal(fake.href(), 'https://app.test/app/library');
  assert.equal(fake.entries().length, 1);
  unsubscribe();
});

test('closing returns to the page section the person was reading', async () => {
  const fake = createFakeWindow(['https://app.test/app/task/s1#section']);
  fake.install();
  const { unsubscribe } = watch();

  openOverlay('file/A');
  assert.equal(fake.entries().length, 2, 'an ordinary fragment is not replaced');
  assert.equal(readOverlayHash(), 'file/A');

  closeOverlay();
  await settle();

  assert.equal(fake.href(), 'https://app.test/app/task/s1#section');
  assert.equal(readOverlayHash(), 'section');
  unsubscribe();
});

test('moving to another page closes the open overlay', () => {
  const fake = createFakeWindow(['https://app.test/app/library']);
  fake.install();
  const { seen, unsubscribe } = watch();

  openOverlay('file/A');
  // The App Router writes the new URL itself — no hashchange, no popstate.
  window.history.pushState(null, '', 'https://app.test/app/scheduled');
  assert.deepEqual(seen, ['file/A'], 'nothing told the host yet');

  syncOverlayHash();
  assert.deepEqual(seen, ['file/A', '']);
  assert.equal(readOverlayHash(), '');

  // Close on the bare page is a no-op: nothing to pop, nothing to strip.
  closeOverlay();
  assert.equal(fake.href(), 'https://app.test/app/scheduled');
  assert.equal(fake.entries().length, 3);
  unsubscribe();
});

test('an overlay opened while another is closing still opens', async () => {
  const fake = createFakeWindow(['https://app.test/app/library']);
  fake.install();
  const { unsubscribe } = watch();
  openOverlay('file/A');
  closeOverlay();
  openOverlay('file/B');
  await settle();
  assert.equal(readOverlayHash(), 'file/B');
  closeOverlay();
  await settle();
  unsubscribe();
});

test('browser Back cannot dismiss an overlay while it is submitting', async () => {
  const fake = createFakeWindow(['https://app.test/app/library']);
  fake.install();
  const { unsubscribe } = watch();
  openOverlay('new-workspace');
  const release = preventOverlayClose();
  window.history.back();
  await settle();
  assert.equal(readOverlayHash(), 'new-workspace');
  release();
  closeOverlay();
  await settle();
  assert.equal(readOverlayHash(), '');
  unsubscribe();
});
