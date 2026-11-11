/** Generation quality sets the price of an image or video, so the wrong quality is a wrong charge. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseStoredToolSettings,
  resolveEffectiveQuality,
} from '../../src/features/permissions/lib/tool-settings.ts';

test('the agent asking for low or high beats the saved default; an unspecified ask uses it', () => {
  assert.equal(resolveEffectiveQuality('high', 'low'), 'high');
  assert.equal(resolveEffectiveQuality('low', 'high'), 'low');
  assert.equal(resolveEffectiveQuality('mid', 'high'), 'high');
  assert.equal(resolveEffectiveQuality('mid', undefined), 'mid');
});

test('a corrupt saved setting reads as no default instead of breaking every generation', () => {
  assert.deepEqual(parseStoredToolSettings({ defaultQuality: 'high' }), { defaultQuality: 'high' });
  for (const stored of [{ defaultQuality: 'ultra' }, 'garbage', null]) {
    assert.deepEqual(parseStoredToolSettings(stored), {});
  }
});
