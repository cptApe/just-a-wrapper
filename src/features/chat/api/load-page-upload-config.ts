import 'server-only';
import { type UploadConfig } from '@/features/files';
import { uploadConfig } from '@/features/files/server';
import { captureException } from '@/lib/observability';

// A failed settings read costs the page its file picker, never the page itself.
export async function loadPageUploadConfig(): Promise<UploadConfig> {
  try {
    return await uploadConfig(null);
  } catch (error) {
    captureException(error, { op: 'page-upload-config' });
    return { enabled: false, reason: 'File uploads aren’t available right now.' };
  }
}
