import { AdminStatusBanner } from '@/components/admin/status-banner';
import { getTierConfigDrift } from '@/features/agent-setup/api/prompt-drift';
import { withRequestContext } from '@/lib/request-context';

export async function AgentDriftStatus() {
  const drift = await withRequestContext({ route: 'admin-prompts-page' }, getTierConfigDrift);
  const fields = [
    ...new Set(drift.flatMap(({ state }) => (state.kind === 'drifted' ? state.fields : []))),
  ];
  if (fields.length > 0) {
    return (
      <AdminStatusBanner tone="attention">
        Live agents do not match these prompts, tools, or network settings. Run pnpm seed:agents to
        update them. Review the environment diff and use --update-environment to apply network
        changes.
        <p>{fields.join(', ')}</p>
      </AdminStatusBanner>
    );
  }
  if (drift.every(({ state }) => state.kind === 'in-sync')) {
    return <AdminStatusBanner tone="ready">Live agents match these prompts</AdminStatusBanner>;
  }
  return (
    <p role="status" className="text-body text-muted-foreground">
      Could not compare these prompts with the live agents
    </p>
  );
}
