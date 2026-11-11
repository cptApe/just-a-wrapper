import { test } from 'node:test';
import { RuleTester } from 'eslint';
import rule from '../../eslint-rules/no-machine-status-write.mjs';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2024, sourceType: 'module' } });
const filename = '/project/src/features/tasks/api/other.ts';
const imports = "import { task, session, workspace, integration, file } from '@/db/schema';";
const invalid = (code) => ({ filename, code: imports + code, errors: [{ messageId: 'owned' }] });
test('machine status columns stay in their exact transition modules', () => {
  tester.run('no-machine-status-write', rule, {
    valid: [
      { filename, code: imports + "db.update(task).set({ title: 'new' });" },
      { filename, code: imports + 'db.select({ status: task.status }).from(task);' },
      { filename, code: "const task = {}; store.update(task).set({status: 'done'});" },
      {
        filename: '/project/src/features/tasks/api/task-transitions.ts',
        code: imports + "db.update(task).set({status: 'done'});",
      },
      {
        filename: '/project/tests/integration/sample.test.ts',
        code: imports + "db.update(task).set({status: 'done'});",
      },
      { filename, code: imports + 'db.insert(session).values({hiddenAt: now});' },
      {
        filename: '/project/src/db/migrations/seed.ts',
        code: imports + "db.insert(task).values({status: 'done'});",
      },
    ],
    invalid: [
      invalid("db.update(task).set({status: 'done'});"),
      invalid("tx.insert(task).values({status: 'creating'});"),
      invalid("db.insert(task).values({title: 'x'}).onConflictDoUpdate({set: {status: 'done'}});"),
      invalid("const values = {status: 'done'}; db.update(task).set({...values});"),
      invalid("const update = db.update(task); update.set({'status': 'done'});"),
      invalid('db.update(file).set({deletedAt: null});'),
      invalid('db.update(workspace).set({purgeAttemptedAt: new Date()});'),
      invalid("db.insert(task).values([{status: 'creating'}]);"),
      invalid("db.update(task).set(condition ? {status: 'done'} : {title: 'x'});"),
      {
        filename,
        code: "import { task as schedule } from '@/db/schema/task'; db.update(schedule).set({status:'done'});",
        errors: [{ messageId: 'owned' }],
      },
      {
        filename,
        code: "import * as schema from '@/db/schema'; db.update(schema.task).set({status:'done'});",
        errors: [{ messageId: 'owned' }],
      },
      {
        filename: '/project/src/features/tasks/api/fake-transitions.ts',
        code: imports + "db.update(task).set({status:'done'});",
        errors: [{ messageId: 'owned' }],
      },
    ],
  });
});

const ledgerImports = "import { creditGrant } from '@/db/schema';";
const ledgerWrite = (code, file = filename) => ({ filename: file, code: ledgerImports + code });
const ledgerInvalid = (code, errors = [{ messageId: 'ownedTable' }]) => ({
  ...ledgerWrite(code),
  errors,
});
test('credit_grant rows are written only in the ledger transitions module', () => {
  tester.run('no-machine-status-write', rule, {
    valid: [
      ledgerWrite(
        'ledger.tx.insert(creditGrant).values(input);',
        '/project/src/features/billing/api/credit-grant-transitions.ts',
      ),
      ledgerWrite(
        'ledger.tx.update(creditGrant).set({ consumed });',
        '/project/src/features/billing/api/credit-grant-transitions.ts',
      ),
      ledgerWrite(
        "ledger.tx.update(creditGrant).set({ status: 'retired' });",
        '/project/src/features/billing/api/credit-grant-transitions.ts',
      ),
      ledgerWrite(
        'database.insert(creditGrant).values(input);',
        '/project/tests/integration/billing-ledger.test.ts',
      ),
      ledgerWrite("tx.select().from(creditGrant).for('update');"),
      { filename, code: 'const creditGrant = {}; tx.insert(creditGrant).values({ amount: 1 });' },
    ],
    invalid: [
      ledgerInvalid('tx.insert(creditGrant).values(input);'),
      ledgerInvalid('tx.update(creditGrant).set({ consumed: 0 });'),
      ledgerInvalid('const update = tx.update(creditGrant); update.set({ amount: 1 });'),
      {
        filename: '/project/src/features/billing/api/grant-topup.ts',
        code: "import * as schema from '@/db/schema'; tx.insert(schema.creditGrant).values(input);",
        errors: [{ messageId: 'ownedTable' }],
      },
      ledgerInvalid(
        'tx.insert(creditGrant).values(input).onConflictDoUpdate({ set: { amount: 1 } });',
        [{ messageId: 'ownedTable' }, { messageId: 'ownedTable' }],
      ),
      ledgerInvalid("tx.update(creditGrant).set({ status: 'retired' });", [
        { messageId: 'ownedTable' },
        { messageId: 'owned' },
      ]),
      {
        ...ledgerWrite(
          "tx.insert(creditGrant).values({ source: 'debt' }).onConflictDoNothing();",
          '/project/src/features/billing/api/reverse-payment-grants.ts',
        ),
        errors: [{ messageId: 'ownedTable' }],
      },
      {
        ...ledgerWrite(
          "tx.update(creditGrant).set({ status: 'retired' });",
          '/project/src/features/billing/api/credit-ledger.ts',
        ),
        errors: [{ messageId: 'ownedTable' }, { messageId: 'owned' }],
      },
    ],
  });
});
