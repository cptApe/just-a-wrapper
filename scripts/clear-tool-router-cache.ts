// Maintenance clears the authoritative cache; warm processes validate it on every request.
import { clearToolRouterCache } from '../src/features/integrations/api/tool-router-transitions.ts';

const target = process.argv[2];
if (target === undefined) {
  console.log('Usage: pnpm composio:remint <composio_user_id>|--all');
  process.exitCode = 1;
} else {
  const cleared = await clearToolRouterCache(
    target === '--all' ? { kind: 'all' } : { kind: 'member', memberId: target },
  );
  console.log(`Cleared Tool Router cache for ${cleared} member(s).`);
}
