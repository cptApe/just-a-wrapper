import type { Metadata } from 'next';
import { Boundary } from '@/components/layouts/boundary';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminPage } from '@/features/admin/components/admin-page';
import { AgentDriftStatus } from '@/features/admin/components/agent-drift-status';
import { PromptsAdmin } from '@/features/agent-setup/components/prompts-admin';

export const metadata: Metadata = { title: 'Prompts' };

// Drift is read from the live agents, so a prerender would freeze the answer.
export const dynamic = 'force-dynamic';

export default function AdminPromptsPage() {
  return (
    <AdminPage slug="prompts">
      <Boundary
        loading={<Skeleton aria-hidden className="h-14 w-full rounded-xl" />}
        error={<p className="text-body text-muted-foreground">Could not check the live agents</p>}
      >
        <AgentDriftStatus />
      </Boundary>
      <PromptsAdmin />
    </AdminPage>
  );
}
