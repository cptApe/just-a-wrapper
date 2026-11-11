// The ordered layer table for src/features (decision 0040). A feature may import a feature in a
// lower layer, or one listed before it in its own layer. A diff to this file is an architecture
// change: review it as one. Every folder under src/features appears here exactly once.
const FEATURE_LAYERS = [
  // Imports no feature: the Anthropic client and tier config, overlays, preferences, realtime, theme.
  { layer: 'platform', features: ['agents', 'overlays', 'preferences', 'realtime', 'theme'] },
  // The session record, notifications and credits.
  { layer: 'kernel', features: ['notifications', 'sessions', 'billing'] },
  // Resources an agent session can use.
  {
    layer: 'library',
    features: [
      'files',
      'voice',
      'auth',
      'memory',
      'skills',
      'tool-catalog',
      'permissions',
      'integrations',
    ],
  },
  // Starting, sending, relaying, gating and reconciling sessions; tasks and schedules.
  { layer: 'runtime', features: ['session-runtime', 'tasks'] },
  // Search, agent setup (seed plan, prompts) and tool execution.
  { layer: 'capabilities', features: ['search', 'agent-setup', 'tools'] },
  // Workspace lifecycle, inbound events, recovery jobs and screens.
  {
    layer: 'product',
    features: ['workspaces', 'webhooks', 'jobs', 'chat', 'feedback', 'scheduled'],
  },
  // The app shell, settings shell, admin console and marketing page.
  { layer: 'chrome', features: ['shell', 'settings', 'admin', 'landing'] },
];

export default FEATURE_LAYERS;
