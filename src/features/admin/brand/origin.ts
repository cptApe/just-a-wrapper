import { SITE_URL, siteUrlIsPlaceholder } from '@/lib/brand/identity';
import { AppError } from '@/lib/errors';

export type ResolvedOrigin = {
  /** The live origin, no trailing slash. */
  url: string;
  /** Where it came from: the env value, or the local placeholder when that is unset. */
  from: 'NEXT_PUBLIC_APP_URL' | 'placeholder';
  /** The host alone, for the URL line of a search result. */
  host: string;
};

export function resolvedOrigin(): ResolvedOrigin {
  const url = SITE_URL;
  const from: ResolvedOrigin['from'] = siteUrlIsPlaceholder ? 'placeholder' : 'NEXT_PUBLIC_APP_URL';
  let host: string;
  try {
    host = new URL(url).host;
  } catch (cause) {
    // Names the source, which an opaque TypeError would not.
    throw new AppError(
      'VALIDATION_FAILED',
      'The site origin is not a valid URL, so no absolute link can be built from it.',
      { url, from },
      { cause },
    );
  }
  return { url, from, host };
}
