'use client';

import { AppDataProviders } from '@/components/providers/app-providers';
import { DisplayFormatProvider } from '@/components/providers/display-format-provider';
import { resetWorkspaceClientState } from '@/features/chat/lib/workspace-client-state';
import type { DisplayFormat } from '@/lib/format/display-format';

// Shared providers never import features, and a server layout cannot pass a function prop.
export function AppProviders({
  organizationId,
  displayFormat,
  children,
}: {
  organizationId: string | null;
  /** The signed-in person's zone and clock, resolved by the server layout. */
  displayFormat: DisplayFormat;
  children: React.ReactNode;
}) {
  return (
    <AppDataProviders organizationId={organizationId} onWorkspaceChange={resetWorkspaceClientState}>
      <DisplayFormatProvider value={displayFormat}>{children}</DisplayFormatProvider>
    </AppDataProviders>
  );
}
