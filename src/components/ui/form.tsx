'use client';

import type { ComponentProps, KeyboardEvent } from 'react';

// The one <form> in the app: Cmd+Enter or Ctrl+Enter submits through the default button, as a click does.
// Plain Enter stays browser behaviour. Handlers that claim a key call preventDefault and win.

function isModEnter(event: KeyboardEvent<HTMLFormElement>): boolean {
  return (
    // eslint-disable-next-line just-a-wrapper/require-form-primitive -- This is the one Cmd+Enter check in the app.
    event.key === 'Enter' &&
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey &&
    !event.repeat &&
    !event.nativeEvent.isComposing &&
    event.nativeEvent.keyCode !== 229
  );
}

/** The HTML default button: the first submit button the form owns, including ones linked with `form=`. */
function defaultSubmitButton(form: HTMLFormElement): HTMLButtonElement | undefined {
  return Array.from(form.elements).find(
    (element): element is HTMLButtonElement =>
      element instanceof HTMLButtonElement && element.type === 'submit',
  );
}

export function Form({ onKeyDown, ...props }: ComponentProps<'form'>) {
  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || !isModEnter(event)) return;
    const form = event.currentTarget;
    // React bubbles keys through portals; a popover opened from this form is not one of its fields.
    if (!(event.target instanceof Node) || !form.contains(event.target)) return;
    event.preventDefault();
    const submitter = defaultSubmitButton(form);
    if (submitter?.matches(':disabled')) return;
    form.requestSubmit(submitter);
  }

  return (
    // eslint-disable-next-line just-a-wrapper/require-form-primitive -- This is the primitive every other form renders.
    <form {...props} onKeyDown={handleKeyDown} />
  );
}
