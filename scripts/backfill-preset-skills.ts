// Push preset skill changes to the deployment `.env` points at. A provisioned workspace skips preset
// provisioning, so an added or changed preset reaches it only through this pass. Idempotent; needs
// DATABASE_URL and ANTHROPIC_API_KEY for that deployment.
import { backfillPresetSkills } from '../src/features/skills/api/backfill-presets.ts';

const entries = await backfillPresetSkills();
for (const entry of entries) {
  const state = entry.retired ? 'retired, left as is' : entry.repushed ? 'pushed' : 'up to date';
  console.log(`${entry.name}: ${state}`);
}
console.log(`Checked ${entries.length} preset skill(s).`);
