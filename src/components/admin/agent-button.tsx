'use client';

import { CopyButton } from '@/components/ui/copy-button';
import { DelayedTooltip } from '@/components/ui/tooltip';
import { ADMIN_AGENT_BUTTON_TOOLTIP, ADMIN_PROMPT_COPIED_TOAST } from './constants';

type AdminAgentButtonProps = {
  /** Lowercase verb phrase, e.g. "change the name". */
  action: string;
  /** Telemetry op recorded when the copy fails, e.g. `admin.copy-brand-prompt`. */
  op: string;
  /** Fuller accessible name when the same visible label repeats down a page. */
  accessibleLabel?: string;
  /** Extra telemetry context merged into the captured exception. */
  context?: Record<string, unknown>;
  /** Primary when it is the one action on the surface; secondary elsewhere. */
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'default' | 'lg';
  // Server Components pass a finished string because a closure cannot cross the
  // RSC boundary.
} & ({ text: string; getText?: never } | { text?: never; getText: () => string | Promise<string> });

export function AdminAgentButton({
  action,
  op,
  accessibleLabel,
  context,
  variant = 'secondary',
  size = 'sm',
  ...source
}: AdminAgentButtonProps) {
  const label = action.charAt(0).toUpperCase() + action.slice(1);

  return (
    // `successToast` makes CopyButton render one element, which the `asChild`
    // tooltip trigger needs to attach to.
    <DelayedTooltip content={ADMIN_AGENT_BUTTON_TOOLTIP} side="top">
      <CopyButton
        {...source}
        label={label}
        accessibleLabel={accessibleLabel}
        op={op}
        context={context}
        successToast={ADMIN_PROMPT_COPIED_TOAST}
        variant={variant}
        size={size}
        className="min-h-11 touch-manipulation"
      />
    </DelayedTooltip>
  );
}
