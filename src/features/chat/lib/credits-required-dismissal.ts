import { captureException } from '@/lib/observability-client';

// Closing the credits modal holds per workspace for this browser tab. Memory is the
// source during the page's life. Storage only carries it across reloads, and losing
// it reopens one modal, so blocked or cleared storage changes nothing else.

const dismissedWorkspaces = new Set<string>();
const listeners = new Set<() => void>();
const STORAGE_FAILURE_CONTEXT = { feature: 'chat', op: 'credits-required-storage' };
// Snapshot reads run on every render, so blocked storage is tried and reported once.
let storageUsable = true;

function storageKey(organizationId: string): string {
  return `credits-required-dismissed:${organizationId}`;
}

export function subscribeCreditsRequiredDismissal(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isCreditsRequiredDismissed(organizationId: string): boolean {
  if (dismissedWorkspaces.has(organizationId)) return true;
  if (!storageUsable) return false;
  try {
    return sessionStorage.getItem(storageKey(organizationId)) === '1';
  } catch (error) {
    storageUsable = false;
    captureException(error, STORAGE_FAILURE_CONTEXT);
    return false;
  }
}

export function dismissCreditsRequired(organizationId: string): void {
  dismissedWorkspaces.add(organizationId);
  if (storageUsable) {
    try {
      sessionStorage.setItem(storageKey(organizationId), '1');
    } catch (error) {
      storageUsable = false;
      captureException(error, STORAGE_FAILURE_CONTEXT);
    }
  }
  for (const listener of listeners) listener();
}
