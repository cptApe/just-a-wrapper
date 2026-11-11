// Draft conflicts and the Ask agent action through real React hooks in a headless browser.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { editorHookBrowser } from './editor-hooks-browser.mjs';

let browser;
before(async () => {
  browser = await editorHookBrowser();
});
after(async () => {
  await browser?.close();
});

test('after an edit conflict a failed reload keeps the draft; a good reload leaves editing', async (t) => {
  const page = await browser.page(t);
  await page.evaluate(() => {
    const h = window.harness;
    h.draft.saveDraft();
    h.conflict();
  });
  await page.waitForFunction(() => window.harness.draft.editor.kind === 'conflict');
  assert.deepEqual(await page.evaluate(() => window.harness.saves[0].input.base), {
    contentSha256: 'sha',
  });
  await page.evaluate(async () => {
    const h = window.harness;
    h.refetchFails = true;
    await h.draft.reloadAfterConflict();
  });
  assert.equal(await page.evaluate(() => window.harness.draft.editor.draft), 'Original');
  await page.evaluate(async () => {
    window.harness.refetchFails = false;
    await window.harness.draft.reloadAfterConflict();
  });
  await page.waitForFunction(() => window.harness.draft.editor.kind === 'read');
});

test('a conflicted draft cannot be saved again, and discarding says so explicitly', async (t) => {
  const page = await browser.page(t);
  await page.evaluate(() => {
    window.harness.draft.saveDraft();
    window.harness.conflict();
  });
  await page.waitForFunction(() => window.harness.draft.editor.kind === 'conflict');
  await page.evaluate(() => {
    window.harness.draft.saveDraft();
    window.harness.commandsHook.deleteNote('discard');
  });
  assert.equal(await page.evaluate(() => window.harness.saves.length), 1);
  assert.equal(
    await page.evaluate(
      () => window.harness.commands.find(([kind]) => kind === 'remove')[1].intent,
    ),
    'discard',
  );
});

test('a second Ask agent press while the first is pending starts no second task', async (t) => {
  const page = await browser.page(t);
  await page.evaluate(() => window.harness.task.askAgent());
  await page.waitForFunction(() => window.harness.task.pending);
  await page.evaluate(() => window.harness.task.askAgent());
  assert.equal(await page.evaluate(() => window.harness.taskCalls), 1);
  await page.evaluate(() => window.harness.finishTask({ ok: true, data: { sessionId: 'task' } }));
  await page.waitForFunction(() => !window.harness.task.pending);
  assert.deepEqual(await page.evaluate(() => window.harness.routes), ['/app/task/task']);
});
