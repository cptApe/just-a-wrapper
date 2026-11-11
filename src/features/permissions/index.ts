export { isConfigurableCustomTool } from './constants';
// Server public API for permissions. Browser callers import server-action files
// directly so this server-only barrel does not enter the client graph.

export { resolveCustomToolPolicy } from './api/custom-tool-policy';
export { resolveToolGate } from './api/gate-policy';
export { type BuiltinToolGate, decideBuiltinToolGate } from './lib/resolve';

export type { GateOutcome } from './types';
