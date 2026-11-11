import { test } from 'node:test';
import { RuleTester } from 'eslint';
import requireFormPrimitive from '../../eslint-rules/require-form-primitive.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2024,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

test('require-form-primitive', () => {
  ruleTester.run('require-form-primitive', requireFormPrimitive, {
    valid: [
      '<Form onSubmit={save}><Input /></Form>;',
      'function send() { model.requestSubmit(); }',
      // Enter on something that is not a text field, such as an approval card.
      '<section onKeyDown={(event) => { if (event.key === "Enter") approve(); }} />;',
      // Global shortcuts and row selection read modifiers without Enter.
      'function onKey(event) { if ((event.metaKey || event.ctrlKey) && event.key === "k") open(); }',
      '<Input onKeyDown={(event) => { if (event.key === "Escape") cancel(); }} />;',
      '<Modal><Form><Input /><ModalFooter /></Form></Modal>;',
      '<Modal><p>Sure?</p><ModalFooter /></Modal>;',
      '<div><Input type="search" /><Modal><ModalFooter /></Modal></div>;',
    ],
    invalid: [
      { code: '<form onSubmit={save} />;', errors: [{ messageId: 'rawForm' }] },
      {
        code: 'function submit(event) { event.currentTarget.form?.requestSubmit(); }',
        errors: [{ messageId: 'formSubmitCall' }],
      },
      {
        code: 'function submit(ref) { ref.current.form.requestSubmit(); }',
        errors: [{ messageId: 'formSubmitCall' }],
      },
      {
        code: 'function onKey(e) { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save(); }',
        errors: [{ messageId: 'modEnterHandler' }],
      },
      {
        code: '<Textarea onKeyDown={(e) => { if (e.key === "Enter") save(); }} />;',
        errors: [{ messageId: 'enterKeyCommit' }],
      },
      {
        code: '<input onKeyDown={(e) => { if (e.key === "Enter") save(); }} />;',
        errors: [{ messageId: 'enterKeyCommit' }],
      },
      {
        code: '<Modal><Input /><ModalFooter /></Modal>;',
        errors: [{ messageId: 'modalWithoutForm' }],
      },
    ],
  });
});
