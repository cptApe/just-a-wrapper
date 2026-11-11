import 'server-only';
import { isEnvironmentKeySet } from '@/lib/env';
import { ENV_REGISTRY } from './env-registry';
import type { EnvKeyInfo } from './env-registry-types';

// Only presence booleans cross into the browser; values stay in env.ts.

export type EnvKeyStatus = EnvKeyInfo & { isSet: boolean };

export function readEnvironmentKeys(): EnvKeyStatus[] {
  return ENV_REGISTRY.map((key) => ({ ...key, isSet: isEnvironmentKeySet(key.name) }));
}
