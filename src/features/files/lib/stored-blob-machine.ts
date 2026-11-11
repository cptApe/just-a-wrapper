import { AppError } from '@/lib/errors';

// Tokens and interactive upload attempts have one day to acquire a durable reference.
const UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;
export function storedBlobState(
  uploadedAt: Date,
  referenced: boolean,
  now: Date,
): 'unclaimed' | 'referenced' | 'expired' {
  if (referenced) return 'referenced';
  return now.getTime() - uploadedAt.getTime() >= UPLOAD_GRACE_MS ? 'expired' : 'unclaimed';
}

// Metadata must commit well before the orphan grace period, so a delayed sync cannot resurrect swept bytes.
export function assertFreshUpload(uploadedAt: Date, now: Date): void {
  if (now.getTime() - uploadedAt.getTime() >= 60 * 60 * 1000) {
    throw new AppError('VALIDATION_FAILED', 'This upload expired. Upload the file again.', {});
  }
}
