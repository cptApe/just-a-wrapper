import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GetUserContextOutputSchema,
  projectUserContext,
} from '../../src/features/tool-catalog/get-user-context.ts';

// The agent reads this about the member. Anything beyond these fields (Stripe or Composio
// ids, tokens, vendor costs) would leak into the model's context.
test('the context the agent reads about a member holds only the facts meant for it', () => {
  const projected = projectUserContext({
    displayName: 'Alex',
    email: 'alex@example.com',
    timezone: 'Europe/Vilnius',
    workspaceName: 'Acme Workspace',
    role: 'owner',
    plan: 'Pro',
    creditsRemaining: 1234,
    connectedApps: ['Gmail'],
    skills: ['Lead triage'],
    stripeCustomerId: 'cus_secret',
    composioUserId: 'composio_secret',
  });
  assert.deepEqual(GetUserContextOutputSchema.parse(projected), {
    user: { displayName: 'Alex', email: 'alex@example.com', timezone: 'Europe/Vilnius' },
    workspace: { name: 'Acme Workspace', role: 'owner', plan: 'Pro', creditsRemaining: 1234 },
    connectedApps: ['Gmail'],
    skills: ['Lead triage'],
  });
  assert.doesNotMatch(JSON.stringify(projected), /secret/);
});
