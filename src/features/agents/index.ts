// Public surface of the agents feature. Other features import from here, never
// reach past into internals.

// Server-side Anthropic client singleton + seeded-resource resolvers. Re-exported
// so sibling features (e.g. sessions/chat) attach to sessions without reaching
// past the public surface or re-instantiating the SDK.
export {
  getAnthropicClient,
  requireAgentId,
  requireAnthropicClient,
  requireEnvironmentId,
} from './api/anthropic-client';

export { tierSupportsSystemMessages } from './config';
export type {
  AgentTier,
  TokenUsage,
} from './types';
