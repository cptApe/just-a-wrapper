import { createHash } from 'node:crypto';

export function vaultCredentialKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
