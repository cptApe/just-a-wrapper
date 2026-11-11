# One Form primitive with Cmd+Enter

- **Status:** Accepted
- **Date:** November 2026

## Context

People expect Cmd+Enter to save anywhere they edit a value. In August 2026 we added a shared shortcut helper and wired it into dialogs one by one, so each new form had to remember it.

## Decision

Every place a person edits and commits a value uses `Form` from [`@/components/ui/form`](../../src/components/ui/form.tsx). The save button is `type="submit"`.

`just-a-wrapper/require-form-primitive` fails on a raw `<form>`, a hand-written Cmd+Enter, `requestSubmit()`, an Enter handler on a text field and a modal with a text field and no `Form`. See [03-patterns.md](../spec/03-patterns.md#forms-the-one-way-to-build-one).

## Why

The shortcut presses the form's default button, so `disabled` means unchanged, invalid and pending for the mouse and the keyboard alike. A primitive and a lint rule replace a helper that each form had to call.

## Consequences

- New forms get the shortcut for free.
- Suppress the rule only with a reason, and only when the key does not submit anything.
- Do not reintroduce a per-component keyboard handler.
