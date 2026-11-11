'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { IconAlertCircle } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code-block';
import { useAsyncAction } from '@/hooks/use-async-action';
import { captureException } from '@/lib/observability-client';
import type { ChatItem } from '../lib/chat-state';
import { useChatRetry } from './chat-retry-context';
import { ActivityLine, LineBody } from './tool-renderers/activity-line';

type ErrorItem = Extract<ChatItem, { type: 'error' }>;

const UNKNOWN_MESSAGE = 'Something unexpected stopped this task.';
const PLAIN_MESSAGES: Partial<Record<string, string>> = {
  model_overloaded: 'The service is busy right now.',
  model_rate_limited: 'The service hit a temporary speed limit.',
  model_request_failed: 'The reply could not be generated.',
  mcp_connection_failed: 'One of your connected apps could not be reached.',
  mcp_authentication_failed: 'One of your connected apps needs to be reconnected.',
  credential_host_unreachable: 'A service this task depends on could not be reached.',
};

// Every action on the card is a 44px target on touch widths, 36px from `sm`.
const ACTION_TARGET = 'min-h-11 sm:min-h-9';

export function ErrorRow({ item }: { item: ErrorItem }) {
  const retry = useChatRetry();
  const request = useAsyncAction();
  const resuming = request.pending;
  const [open, setOpen] = useState(false);

  // The platform retries transient errors on its own and the reply keeps
  // streaming, so a "retrying" error is noise to the person reading: nothing
  // renders. Exhausted and terminal errors below are the ones that need them.
  if (item.retryStatus === 'retrying') return null;

  // Upstream types arrive with an `_error` suffix that the catalog above omits.
  const kind = item.errorType?.replace(/_error$/, '');
  const authentication = kind === 'mcp_authentication_failed';
  const retryable = item.retryStatus === 'exhausted' && !authentication;
  const message = PLAIN_MESSAGES[kind ?? ''] ?? UNKNOWN_MESSAGE;

  async function resume(): Promise<void> {
    if (!retry) return;
    await request.run(async () => {
      try {
        await retry();
      } catch (error) {
        captureException(error, { op: 'resume-session-from-error' });
        toast.error('Couldn’t retry the task. Try again.');
      }
    });
  }

  // `retry` is null for a teammate, and the connection to repair is the owner's.
  const action =
    authentication && retry ? (
      <Button asChild size="sm" variant="secondary" className={ACTION_TARGET}>
        <Link href="/app/tools">Reconnect app</Link>
      </Button>
    ) : retryable && retry ? (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className={ACTION_TARGET}
        disabled={resuming}
        onClick={() => void resume()}
      >
        {resuming ? 'Retrying…' : 'Retry'}
      </Button>
    ) : null;

  // An error is one activity line like every tool call: the plain sentence,
  // a chevron on hover, and the raw error text unfolding under it in the same
  // code block every tool output uses. The action button always stays visible.
  return (
    <div role="alert">
      <ActivityLine
        icon={<IconAlertCircle className="size-4 text-destructive" />}
        text={message}
        status="failed"
        expanded={open}
        onToggle={() => setOpen((value) => !value)}
        data-testid="error-row"
      >
        {open ? (
          <LineBody>
            <CodeBlock code={item.text} label="Error" />
          </LineBody>
        ) : null}
        {action ? (
          <LineBody>
            <div className="flex flex-wrap items-center gap-2">{action}</div>
          </LineBody>
        ) : null}
      </ActivityLine>
    </div>
  );
}
