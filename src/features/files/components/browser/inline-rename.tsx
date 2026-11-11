'use client';

import * as React from 'react';
import { flushSync } from 'react-dom';
import { Form } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { renameReducer } from '../../lib/rename-machine';

// Inline rename commits on submit or blur and cancels on Escape.
// The caller owns the asynchronous mutation and optimistic state.

export function InlineRenameInput({
  initialValue,
  onCommit,
  onCancel,
  className,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [state, dispatch] = React.useReducer(renameReducer, { kind: 'editing' });
  const inputRef = React.useRef<HTMLInputElement>(null);

  function commit(value: string) {
    if (state.kind !== 'editing') return;
    flushSync(() => dispatch('commit'));
    const trimmed = value.trim();
    if (trimmed === '' || trimmed === initialValue) onCancel();
    else onCommit(trimmed);
  }

  return (
    <Form
      onSubmit={(event) => {
        event.preventDefault();
        if (inputRef.current) commit(inputRef.current.value);
      }}
      onKeyDown={(event) => {
        // The surrounding row has its own Enter and arrow shortcuts.
        event.stopPropagation();
        if (event.key === 'Escape' && state.kind === 'editing') {
          flushSync(() => dispatch('cancel'));
          onCancel();
        }
      }}
      className="contents"
    >
      <input
        ref={inputRef}
        type="text"
        defaultValue={initialValue}
        autoFocus
        aria-label="New name"
        onFocus={(e) => {
          // Select the basename, keep the extension (Finder behavior).
          const dot = e.currentTarget.value.lastIndexOf('.');
          e.currentTarget.setSelectionRange(0, dot > 0 ? dot : e.currentTarget.value.length);
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={(e) => commit(e.currentTarget.value)}
        className={cn(
          'w-full min-w-0 rounded-md bg-background px-1 py-0.5 text-title-card text-foreground',
          'shadow-[inset_0_0_0_1px_var(--color-alpha-16)] outline-none',
          'focus:shadow-[inset_0_0_0_1px_var(--color-alpha-24)]',
          className,
        )}
      />
    </Form>
  );
}
