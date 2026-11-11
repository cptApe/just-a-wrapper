import { AppError } from './errors';

export function imageContentSecurityPolicy(blobToken: string | undefined): string {
  const storeId = blobToken ? /^vercel_blob_rw_([a-z0-9]+)_/i.exec(blobToken)?.[1] : undefined;
  if (blobToken && !storeId)
    throw new AppError('VALIDATION_FAILED', 'BLOB_READ_WRITE_TOKEN has no valid store ID.');
  const sources = [
    "'self'",
    'data:',
    'blob:',
    'https://logos.composio.dev',
    'https://lh3.googleusercontent.com',
    'https://www.google.com',
    'https://*.gstatic.com',
    ...(storeId ? [`https://${storeId.toLowerCase()}.private.blob.vercel-storage.com`] : []),
  ];
  return `img-src ${sources.join(' ')};`;
}
