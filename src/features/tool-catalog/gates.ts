import type { Capabilities } from '@/lib/capabilities';
import type { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';

// The capability a tool needs before it is offered. A declaration names its gate; a tool with
// no gate is always on.
type GatingCapability = 'media' | 'webSearch' | 'browser';
export type ToolGate = {
  [Capability in GatingCapability]: {
    capability: Capability;
    /** The provider kind that turns the tool on. */
    on: Capabilities[Capability]['kind'];
    /** Search tools swap providers rather than go off, so they have no message. */
    offMessage: keyof typeof CAPABILITY_OFF_MESSAGES | null;
  };
}[GatingCapability];

export const MEDIA_GATE: ToolGate = { capability: 'media', on: 'gateway', offMessage: 'media' };
export const EXA_GATE: ToolGate = { capability: 'webSearch', on: 'exa', offMessage: null };
export const ANTHROPIC_WEB_GATE: ToolGate = {
  capability: 'webSearch',
  on: 'anthropic',
  offMessage: null,
};
export const LIVE_BROWSER_GATE: ToolGate = {
  capability: 'browser',
  on: 'browserbase',
  offMessage: 'liveBrowser',
};
