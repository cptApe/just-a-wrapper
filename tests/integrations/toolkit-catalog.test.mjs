import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COMPOSIO_TOOLKIT_ALLOWLIST,
  TOOLKIT_GROUPS,
  TOOLKIT_METADATA,
} from '../../src/lib/composio/toolkits.ts';

// The allowlist decides which apps the MCP proxy opens; the metadata decides what the Apps tab
// shows. An app in one and not the other is offered but cannot connect, or connects unseen.
test('the apps a member can connect are exactly the apps the Apps tab shows', () => {
  assert.deepEqual(Object.keys(TOOLKIT_METADATA).sort(), [...COMPOSIO_TOOLKIT_ALLOWLIST].sort());
  const groupIds = new Set(TOOLKIT_GROUPS.map((group) => group.id));
  for (const [slug, meta] of Object.entries(TOOLKIT_METADATA)) {
    assert.equal(meta.slug, slug);
    assert.ok(groupIds.has(meta.group), `${slug} is on no shelf`);
  }
});
