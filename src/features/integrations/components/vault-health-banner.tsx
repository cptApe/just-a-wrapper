'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { IconAlertTriangle } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { WarningBar } from '@/components/ui/warning-bar';
import { captureException } from '@/lib/observability-client';
import { getMemberVaultHealth, reconnectMemberVault } from '../api/connections';
import type { VaultHealth } from '../types';

export function VaultHealthBanner({ initial: health }: { initial: VaultHealth }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  if (health.status === 'healthy') return null;
  const broken = health.status === 'broken' || health.status === 'unprovisioned';

  const retry = () => {
    startTransition(async () => {
      try {
        const next = await (broken ? reconnectMemberVault() : getMemberVaultHealth());
        if (next.status === 'healthy') {
          toast.success(broken ? 'Agent connection restored' : 'Agent connection checked');
        } else if (next.status === 'unprovisioned') {
          toast.error('Agent connection is not configured yet.');
        } else if (next.status === 'broken') {
          toast.error('Agent connection still needs attention.');
        } else {
          toast.error('Couldn’t finish the connection check.');
        }
        router.refresh();
      } catch (error) {
        captureException(error, { op: 'retry-member-vault-health' });
        toast.error('Couldn’t check the connection. Try again.');
      }
    });
  };

  return (
    <WarningBar
      role={broken ? 'alert' : 'status'}
      icon={IconAlertTriangle}
      message={
        broken
          ? 'Agent connection needs attention. Reconnect to keep tools working.'
          : 'Couldn’t check the agent connection.'
      }
      action={
        <Button type="button" size="sm" onClick={retry} disabled={isPending}>
          {isPending ? 'Checking…' : broken ? 'Reconnect' : 'Check again'}
        </Button>
      }
    />
  );
}
