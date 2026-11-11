// Creating or editing a skill in chat when the account cannot pay: the member sees the server's
// reason, nothing navigates, and only a real failure is reported as an incident.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { editorHookBrowser } from '../memory/editor-hooks-browser.mjs';

let browser;
before(async () => {
  browser = await editorHookBrowser();
});
after(async () => {
  await browser?.close();
});

for (const action of ['create', 'edit']) {
  for (const code of ['CREDITS_EXHAUSTED', 'UNEXPECTED']) {
    test(`${action} in chat with ${code} shows one error and opens no chat`, async (t) => {
      const page = await browser.page(t);
      await page.evaluate(
        async ({ action, code }) => {
          const h = window.harness;
          h.response = {
            code,
            status: code === 'UNEXPECTED' ? 500 : 402,
            message: 'Account limit reached.',
          };
          await (action === 'create' ? h.create.createWithAgent() : h.edit.editInChat());
        },
        { action, code },
      );
      const result = await page.evaluate(() => ({
        errors: window.harness.messages.filter((message) => message.kind === 'error'),
        captured: window.harness.captured,
        routes: window.harness.routes,
      }));
      assert.equal(result.errors.length, 1);
      assert.equal(result.captured.length, code === 'UNEXPECTED' ? 1 : 0);
      assert.equal(result.routes.length, 0);
      if (code !== 'UNEXPECTED') assert.equal(result.errors[0].args[0], 'Account limit reached.');
    });
  }
}
