'use client';

import { IconAlertCircle, IconCheck, IconCopy01 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useCopy } from './hooks/use-copy';

type CopySource = { text: string; getText?: never } | { text?: never; getText: () => string };

export function MarkdownCopyAction({
  accessibleLabel,
  disabled = false,
  ...source
}: CopySource & { accessibleLabel: string; disabled?: boolean }) {
  const { copyState, announcement, copy } = useCopy({
    getText: () => (source.getText === undefined ? source.text : source.getText()),
    op: 'markdown.copy',
    context: undefined,
    successToast: undefined,
  });

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-9 text-muted-foreground pointer-coarse:size-11"
        onClick={copy}
        disabled={disabled}
        aria-label={accessibleLabel}
        aria-busy={copyState === 'copying' || undefined}
        title={copyState === 'copied' ? 'Copied' : accessibleLabel}
      >
        {copyState === 'copying' ? (
          <Spinner aria-hidden />
        ) : copyState === 'copied' ? (
          <IconCheck aria-hidden className="size-4" />
        ) : copyState === 'error' ? (
          <IconAlertCircle aria-hidden className="size-4 text-destructive" />
        ) : (
          <IconCopy01 aria-hidden className="size-4" />
        )}
      </Button>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
