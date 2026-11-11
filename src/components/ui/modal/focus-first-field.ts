// A dialog that asks for text opens with the cursor in its first field, not on
// the close button Radix would otherwise focus first. Dialogs without a text
// field keep Radix's default. A field marked data-no-autofocus opens without the cursor.
const TEXT_FIELD_SELECTOR = [
  'textarea:not([disabled]):not([readonly])',
  'input:not([data-no-autofocus]):not([disabled]):not([readonly]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="range"]):not([type="color"])',
  '[contenteditable="true"]',
].join(',');

/** Radix `onOpenAutoFocus` handler: focus the dialog's first text field. */
export function focusFirstTextField(event: Event): void {
  const content = event.currentTarget;
  if (!(content instanceof HTMLElement)) return;
  const field = Array.from(content.querySelectorAll<HTMLElement>(TEXT_FIELD_SELECTOR)).find(
    (element) => element.getClientRects().length > 0,
  );
  if (!field) return;
  event.preventDefault();
  field.focus({ preventScroll: true });
}
