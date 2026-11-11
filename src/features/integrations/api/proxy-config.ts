// Connected apps can be off; null becomes a typed 503 notice in the route.
import 'server-only';
import { capabilities } from '@/lib/runtime-capabilities';

export type ProxyConfig = { jwtSecret: string; composioApiKey: string };

export function proxyConfig(): ProxyConfig | null {
  const { connectedApps } = capabilities;
  return connectedApps.kind === 'composio'
    ? { jwtSecret: connectedApps.jwtSecret, composioApiKey: connectedApps.apiKey }
    : null;
}
