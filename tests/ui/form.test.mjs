// Cmd+Enter submits a form once through its Save button, and never when it should not.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { loadTsx } from '../support/load-tsx.mjs';

const require = createRequire(import.meta.url);

class FakeNode {}
class FakeButton extends FakeNode {
  constructor({ type = 'submit', disabled = false } = {}) {
    super();
    this.type = type;
    this.disabled = disabled;
  }
  matches(selector) {
    return selector === ':disabled' && this.disabled;
  }
}
globalThis.Node = FakeNode;
globalThis.HTMLButtonElement = FakeButton;

const { Form } = loadTsx('src/components/ui/form.tsx', (specifier) => require(specifier));

function fakeForm(elements = [new FakeButton()]) {
  const calls = [];
  return {
    elements,
    calls,
    contains: (node) => node.insideForm !== false,
    requestSubmit(submitter) {
      calls.push(submitter);
    },
  };
}

function press(form, overrides = {}, props = {}) {
  let prevented = overrides.defaultPrevented ?? false;
  const event = {
    key: 'Enter',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    target: new FakeNode(),
    nativeEvent: { isComposing: false, keyCode: 13 },
    currentTarget: form,
    preventDefault() {
      prevented = true;
    },
    ...overrides,
    get defaultPrevented() {
      return prevented;
    },
  };
  Form({ ...props }).props.onKeyDown(event);
  return { prevented };
}

test('Cmd+Enter or Ctrl+Enter submits once through Save, and a disabled Save blocks it', () => {
  for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
    const save = new FakeButton();
    const form = fakeForm([new FakeButton({ type: 'button' }), save, new FakeButton()]);
    assert.equal(press(form, modifier).prevented, true);
    assert.deepEqual(form.calls, [save]);
  }
  const pending = fakeForm([new FakeButton({ disabled: true })]);
  assert.equal(press(pending, { metaKey: true }).prevented, true);
  assert.deepEqual(pending.calls, []);
  const noButton = fakeForm([new FakeButton({ type: 'button' })]);
  press(noButton, { ctrlKey: true });
  assert.deepEqual(noButton.calls, [undefined]);
});

test('typing, held keys, other chords, claimed keys and keys from a portal never submit', () => {
  const outside = new FakeNode();
  outside.insideForm = false;
  for (const [overrides, props] of [
    [{}],
    [{ metaKey: true, nativeEvent: { isComposing: true, keyCode: 229 } }],
    [{ ctrlKey: true, nativeEvent: { isComposing: false, keyCode: 229 } }],
    [{ metaKey: true, repeat: true }],
    [{ metaKey: true, shiftKey: true }],
    [{ metaKey: true, key: 'k' }],
    [{ metaKey: true, defaultPrevented: true }],
    [{ metaKey: true }, { onKeyDown: (event) => event.preventDefault() }],
    [{ metaKey: true, target: outside }],
  ]) {
    const form = fakeForm();
    press(form, overrides, props);
    assert.deepEqual(form.calls, [], JSON.stringify(overrides));
  }
});
