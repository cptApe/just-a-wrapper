'use client';

import { useEffect, useReducer, useRef } from 'react';
import { toast } from 'sonner';
import { CLIPBOARD_ERROR_MESSAGE, copyPromisedTextToClipboard } from '@/lib/clipboard';
import { captureException } from '@/lib/observability-client';
import { copyReducer } from '../lib/copy-machine';

// How long the "copied" check stays before the control returns to rest.
const COPIED_FLASH_MS = 1500;

// Clipboard work starts in the click handler to preserve Safari's user activation.
export function useCopy(options: {
  getText: () => string | Promise<string>;
  op: string;
  context: Record<string, unknown> | undefined;
  successToast: string | undefined;
  /** A failure toast for a control that shows no toast on success. */
  failureToast?: string;
}) {
  const [state, dispatch] = useReducer(copyReducer, { kind: 'idle' });
  const attempt = useRef<AbortController | null>(null);
  useEffect(() => () => attempt.current?.abort(), []);
  useEffect(() => {
    if (state.kind !== 'copied' && state.kind !== 'error') return;
    const timer = window.setTimeout(() => dispatch({ type: 'reset' }), COPIED_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  function copy() {
    if (attempt.current !== null) return;
    const controller = new AbortController();
    attempt.current = controller;
    dispatch({ type: 'start' });
    const pending = (async () => options.getText())();
    function settle(copied: boolean) {
      if (controller.signal.aborted) return;
      attempt.current = null;
      dispatch({ type: 'settle', copied });
      if (options.successToast !== undefined) {
        if (copied) toast.success(options.successToast);
        else toast.error(CLIPBOARD_ERROR_MESSAGE);
      } else if (!copied && options.failureToast !== undefined) {
        toast.error(options.failureToast);
      }
    }
    void copyPromisedTextToClipboard(pending).then(settle, (error: unknown) => {
      captureException(error, { op: options.op, ...options.context });
      settle(false);
    });
  }
  const announcement =
    state.kind === 'copied'
      ? 'Copied to clipboard'
      : state.kind === 'error'
        ? 'Could not copy to clipboard'
        : '';
  return { copyState: state.kind, announcement, copy, reset: () => dispatch({ type: 'reset' }) };
}
