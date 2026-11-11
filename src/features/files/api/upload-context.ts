'use server';

import { headers } from 'next/headers';
import { resolveCaller } from '@/lib/caller';
import { withRequestContext } from '@/lib/request-context';
import type { UploadConfig } from '../types';
import { uploadConfig } from './upload-token';

// Hash overlays resolve upload config and workspace from the authenticated session.
// Feed that result into useDirectUpload; this is not a separate upload pipeline.

export async function getUploadContext(): Promise<{ config: UploadConfig; workspaceId: string }> {
  return withRequestContext({ route: 'files/upload-context' }, async () => {
    const { workspaceId } = await resolveCaller(await headers());
    return { config: await uploadConfig(null), workspaceId };
  });
}
