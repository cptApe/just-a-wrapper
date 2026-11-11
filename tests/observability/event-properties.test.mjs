import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  browserDeploymentEnvironment,
  buildEventProperties,
} from '../../src/lib/observability-properties.ts';

// Without the trace id and environment on every capture, an operator cannot find an error or
// see it on the production-filtered errors chart.

test('every captured error carries its trace, workspace and deploy environment', () => {
  const context = { request_id: 'req_1', trace_id: 'a'.repeat(32), workspace_id: 'ws_1' };
  const props = buildEventProperties(context, { feature: 'tooling' });
  assert.equal(props.trace_id, 'a'.repeat(32));
  assert.equal(props.workspace_id, 'ws_1');
  assert.equal(props.feature, 'tooling');
  assert.ok(['development', 'preview', 'production'].includes(props.environment));
  assert.equal(buildEventProperties(undefined).environment, props.environment);
});

test('the browser reports the same environment the server does', () => {
  const previous = {
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
  };
  try {
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_VERCEL_ENV = 'preview';
    assert.equal(browserDeploymentEnvironment(), 'preview');
    delete process.env.NEXT_PUBLIC_VERCEL_ENV;
    assert.equal(browserDeploymentEnvironment(), 'production');
    process.env.NEXT_PUBLIC_VERCEL_ENV = 'staging';
    process.env.NODE_ENV = 'test';
    assert.equal(browserDeploymentEnvironment(), 'development');
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
