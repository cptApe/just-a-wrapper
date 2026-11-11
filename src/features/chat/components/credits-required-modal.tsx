'use client';

import { useOrganizationId } from '@/components/providers/app-providers';
import { TopupDialog } from '@/features/billing/components/topup-dialog';
import type { useCreditsRequiredModal } from '../hooks/use-credits-required-modal';

export function CreditsRequiredModal({
  modal,
}: {
  modal: ReturnType<typeof useCreditsRequiredModal>;
}) {
  const organizationId = useOrganizationId();
  if (organizationId === null) return null;
  return (
    <TopupDialog
      open={modal.open}
      onClose={modal.close}
      expectedOrganizationId={organizationId}
      title="Add credits to start"
    />
  );
}
