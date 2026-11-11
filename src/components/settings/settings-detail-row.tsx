// onSave may return a promise; resolving false keeps the row open. Handle failures inside onSave (house toast); never throw.
// In stacked layout Edit swaps to Cancel in the same slot, width reserved so the row never shifts.
'use client';

import { type FormEvent, useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Spinner } from '@/components/ui/spinner';
import { useAsyncAction } from '@/hooks/use-async-action';
import { captureException } from '@/lib/observability-client';
import { cn } from '@/lib/utils';
import { RowAction } from './row-action';

// The label stays anchored while editing; stacked fields and Save stay within its column, clear of Cancel.
type SettingsDetailRowProps = {
  label: string;
  /** Display-mode value, muted under the label. */
  value?: React.ReactNode;
  /** One-line helper shown under the label while editing. */
  helper?: string;
  editLabel?: string;
  /** Replaces the Edit affordance in display mode (read-only note, custom control). */
  action?: React.ReactNode;
  /** `stacked` = the account/general layout (Cancel in place, Save below). */
  layout?: 'default' | 'stacked';
  /** Controlled open state; omit to let the row own it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Return (or resolve) `false` to keep the row open after a failed save. */
  onSave?: () => boolean | undefined | Promise<boolean | undefined>;
  /** Called when the user cancels — reset the field state here. */
  onCancel?: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  /** The edit-mode field slot. Omit for a display-only row (no Edit button). */
  children?: React.ReactNode;
  className?: string;
};

export function SettingsDetailRow({
  label,
  value,
  helper,
  editLabel = 'Edit',
  action,
  layout = 'default',
  open: openProp,
  onOpenChange,
  onSave,
  onCancel,
  saveLabel = 'Save',
  saveDisabled = false,
  children,
  className,
}: SettingsDetailRowProps) {
  const formId = useId();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const actionState = useAsyncAction();
  const { pending } = actionState;
  const editable = children !== undefined;
  const open = editable && (openProp ?? uncontrolledOpen);
  const stacked = layout === 'stacked';

  function setOpen(next: boolean) {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  function handleCancel() {
    if (pending) return;
    onCancel?.();
    setOpen(false);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!onSave) {
      setOpen(false);
      return;
    }
    const token = actionState.begin();
    if (token === null) return;
    try {
      const saved = await onSave();
      if (!actionState.isCurrent(token)) return;
      if (saved !== false) setOpen(false);
    } catch (cause) {
      if (!actionState.isCurrent(token)) return;
      // Contract: onSave handles its own failures and returns false. A throw
      // is a caller bug — keep the row open (like false) and report it.
      captureException(cause, { op: 'settings-detail-row.save' });
      toast.error('Couldn’t save your changes. Try again.');
    } finally {
      actionState.finish(token);
    }
  }

  const secondaryClass = cn(
    'text-muted-foreground break-words',
    stacked ? 'text-body' : 'text-meta',
  );

  const editForm = (
    <Form
      id={formId}
      onSubmit={handleSubmit}
      className={cn('flex flex-col animate-in fade-in-0 duration-200', stacked ? 'gap-3' : 'gap-2')}
    >
      {children}
      {stacked ? (
        <Button
          type="submit"
          className="self-start"
          disabled={pending || saveDisabled}
          data-testid="settings-row-save"
        >
          {pending ? <Spinner aria-hidden /> : null}
          {pending ? 'Saving…' : saveLabel}
        </Button>
      ) : null}
    </Form>
  );

  return (
    <div className={cn('flex flex-col', stacked ? 'py-3' : 'gap-3 py-5', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className={cn('flex min-w-0 flex-col', stacked ? 'flex-1 gap-1' : 'gap-0.5')}>
          <span className="text-body font-semibold">{label}</span>
          {open
            ? helper && <span className={secondaryClass}>{helper}</span>
            : value !== undefined && <span className={secondaryClass}>{value}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {open ? (
            stacked ? (
              // Edit → Cancel in place. Same RowAction face as Edit, right-
              // aligned with a reserved min-width so the text swap shifts nothing.
              <RowAction
                className="min-w-[3.25rem] text-right"
                onClick={handleCancel}
                disabled={pending}
              >
                Cancel
              </RowAction>
            ) : (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleCancel}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" form={formId} disabled={pending || saveDisabled}>
                  {pending ? <Spinner aria-hidden /> : null}
                  {pending ? 'Saving…' : saveLabel}
                </Button>
              </>
            )
          ) : (
            (action ??
            (editable ? (
              <RowAction
                className={cn(stacked && 'min-w-[3.25rem] text-right')}
                onClick={() => setOpen(true)}
              >
                {editLabel}
              </RowAction>
            ) : null))
          )}
        </div>
      </div>
      {/* Stacked: the field sits under the label. From sm up its right edge
          stops where Cancel's reserved slot begins; a phone gives it the full
          row width instead of squeezing it beside Cancel. */}
      {stacked && open ? <div className="pt-4 sm:pr-[4.25rem]">{editForm}</div> : null}
      {!stacked && open ? editForm : null}
    </div>
  );
}
