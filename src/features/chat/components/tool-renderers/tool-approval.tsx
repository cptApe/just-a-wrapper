'use client';

import { IconChevronDown } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { RememberScope, ToolGate } from '../../lib/tool-decisions';

// A pending approval is the one tool state that earns a card. It repeats the
// activity line so the decision stands alone, then gives the consequence and
// two direct answers: Don't allow, then Approve as the primary on the right.
// A remembered approval is a second choice under Approve's options arrow, never a
// checkbox that could be ticked before declining. It is offered only when the
// server can store it. Once the relay echoes a confirmation, the card becomes a
// quiet receipt. The parent decides whether that confirmation belongs to an
// ask-gate, so ordinary successful calls never acquire approval history.

const REMEMBER_LABELS: Record<RememberScope, string> = {
  always: 'Always allow this',
  session: 'Allow for this task',
};

export function ToolApproval({
  action,
  consequence,
  decision,
  gate,
  viewerDecides,
}: {
  /** The exact pending activity line, already phrased by tool-display. */
  action: string;
  /** The one consequence a person should read before saying yes; most tools have none. */
  consequence?: string;
  /** Present only after an actual ask-gate confirmation event. */
  decision?: 'allow' | 'deny';
  gate: ToolGate;
  /** The viewer answers approvals on this task, so receipts speak to them. */
  viewerDecides: boolean;
}) {
  if (decision) {
    return (
      <p className="text-meta text-muted-foreground" data-testid="tool-approval-receipt">
        {viewerDecides
          ? decision === 'allow'
            ? 'You approved'
            : 'You declined'
          : decision === 'allow'
            ? 'Approved'
            : 'Declined'}
      </p>
    );
  }

  if (gate.kind !== 'pending') {
    return (
      <p className="text-meta text-muted-foreground" data-testid="tool-approval-waiting">
        Waiting for the task owner to approve
      </p>
    );
  }

  const { busy: disabled, remember, resolve } = gate;
  const approve = () => resolve('once');
  const decline = () => resolve('deny');

  return (
    <section
      aria-label="Approval required"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || disabled) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          approve();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          decline();
        }
      }}
      className="flex w-full max-w-xl flex-col gap-3 rounded-xl bg-alpha-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="tool-approval"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-body-lg font-medium text-foreground">{action}</p>
        {consequence ? <p className="text-meta text-muted-foreground">{consequence}</p> : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          size="lg"
          variant="secondary"
          disabled={disabled}
          onClick={decline}
          className="w-full sm:w-auto"
          data-testid="gate-deny"
        >
          Don&apos;t allow
        </Button>
        <div className="flex w-full sm:w-auto">
          <Button
            type="button"
            size="lg"
            disabled={disabled}
            onClick={approve}
            // Half the right padding when the options arrow follows: the
            // divider plus the arrow's own inset already read as space.
            className={remember ? 'flex-1 rounded-r-none pr-2.5 sm:flex-none' : 'w-full sm:w-auto'}
            data-testid="gate-approve"
          >
            Approve
          </Button>
          {remember ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="lg"
                  disabled={disabled}
                  aria-label="More approval options"
                  // Visually even, not mathematically: the rounded right edge
                  // needs more room than the straight divider side.
                  className="rounded-l-none border-l border-primary-foreground/25 pl-2 pr-3"
                  data-testid="gate-approve-options"
                >
                  <IconChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="min-h-11"
                  onSelect={() => resolve(remember)}
                  data-testid="gate-approve-always"
                >
                  {REMEMBER_LABELS[remember]}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </section>
  );
}
