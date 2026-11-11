'use client';

import { IconAlertCircle, IconCheck, IconCopy01 } from '@/components/icons';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useCopy } from './hooks/use-copy';

type CopyButtonProps = {
  /** Visible label, and the button's accessible name. */
  label: string;
  /** Optional accessible name when repeated visible labels need more context. */
  accessibleLabel?: string;
  /** Telemetry op recorded when a copy fails, e.g. `admin.copy-page`. */
  op: string;
  /** Extra telemetry context merged into the captured exception. */
  context?: Record<string, unknown>;
  /** When set, the outcome is also raised as a toast: this text on success, the
      shared clipboard error on failure. The in-button glyph stays either way;
      the toast is for call sites whose button can scroll out of view before the
      glyph is noticed. Setting it also drops the sr-only live region below,
      because the toast is already announced and two announcements is one too
      many. */
  successToast?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
} & ({ text: string; getText?: never } | { text?: never; getText: () => string | Promise<string> });

export function CopyButton(props: CopyButtonProps) {
  const {
    label,
    accessibleLabel,
    op,
    context,
    successToast,
    variant = 'secondary',
    size = 'xs',
    className,
  } = props;
  const { copyState, announcement, copy } = useCopy({
    getText: () => (props.getText === undefined ? props.text : props.getText()),
    op,
    context,
    successToast,
  });

  const button = (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={copy}
      aria-label={accessibleLabel}
      aria-busy={copyState === 'copying' || undefined}
    >
      {copyState === 'copying' ? (
        <Spinner className="size-3.5" aria-hidden />
      ) : copyState === 'copied' ? (
        <IconCheck className="size-3.5" />
      ) : copyState === 'error' ? (
        <IconAlertCircle className="size-3.5 text-destructive" />
      ) : (
        <IconCopy01 className="size-3.5" />
      )}
      {label}
    </Button>
  );

  // The toast is itself a live region, so pairing it with the one below would
  // read the outcome twice.
  if (successToast !== undefined) return button;

  return (
    <>
      {button}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
