/** The Built-in tab shows every tool the agent can use, with the approval the gate really applies. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ABILITY_ROWS,
  BUILTIN_ABILITY_GROUPS,
  SHELF_CATALOG_TOOLS,
} from '../../src/features/permissions/constants.ts';
import {
  builtinShelfCards,
  filterBuiltinShelfCards,
} from '../../src/features/permissions/lib/builtin-shelf-search.ts';
import {
  CUSTOM_TOOL_NAMES,
  TOOL_DECLARATIONS,
} from '../../src/features/tool-catalog/declarations.ts';
import { NATIVE_PROVIDERS, PAID_PROVIDERS } from '../fixtures/web-capabilities.mjs';

test('every agent tool has exactly one row on the shelf, and no row names a missing tool', () => {
  assert.deepEqual([...SHELF_CATALOG_TOOLS].sort(), [...new Set(CUSTOM_TOOL_NAMES)].sort());
  const custom = ABILITY_ROWS.filter((row) => row.custom !== undefined).map((row) => row.custom);
  assert.equal(new Set(custom).size, custom.length, 'a tool has two shelf rows');
  const cards = builtinShelfCards(PAID_PROVIDERS);
  assert.equal(
    cards.reduce((sum, card) => sum + card.abilities.length, 0),
    ABILITY_ROWS.length,
    'a row is missing from the cards',
  );
});

test('the shelf says "Always asks you" exactly for the tools the gate always parks', () => {
  for (const decl of TOOL_DECLARATIONS) {
    const row = ABILITY_ROWS.find((ability) => ability.custom === decl.name);
    assert.equal(row?.fixedLabel === 'Always asks you', decl.alwaysAsk === true, decl.name);
  }
});

test('a card whose tools are off stays on the shelf and names the missing setting', () => {
  const cards = builtinShelfCards(NATIVE_PROVIDERS);
  assert.deepEqual(
    cards.map((card) => card.group.id),
    BUILTIN_ABILITY_GROUPS.map((group) => group.id),
  );
  assert.match(cards.find((card) => card.group.id === 'create').offReasons.join(' '), /AI_GATEWAY/);
  assert.match(cards.find((card) => card.group.id === 'web').offReasons.join(' '), /BROWSERBASE/);
  const swapped = builtinShelfCards({ ...PAID_PROVIDERS, webSearch: NATIVE_PROVIDERS.webSearch });
  assert.deepEqual(swapped.find((card) => card.group.id === 'web').offReasons, []);
});

test('searching the shelf finds a card by one of its tools and hides the rest', () => {
  const cards = builtinShelfCards(PAID_PROVIDERS);
  assert.equal(filterBuiltinShelfCards('', cards).length, BUILTIN_ABILITY_GROUPS.length);
  assert.deepEqual(
    filterBuiltinShelfCards('run code', cards).map((card) => card.group.id),
    ['files'],
  );
  assert.deepEqual(filterBuiltinShelfCards('nothing-like-this', cards), []);
});
