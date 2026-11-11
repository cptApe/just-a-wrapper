'use client';

import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability-client';
import { adminQueryKeys } from '../../api/keys';
import { OPEN_GRAPH_IMAGE } from '../open-graph';

// An <img> offers only `onError`; fetching gives explicit loading, ready and
// failed states over the exact bytes the route returned.

export type OgImageState =
  | { kind: 'loading' }
  | { kind: 'ready'; src: string }
  | { kind: 'failed' };

const OgImageContext = createContext<OgImageState>({ kind: 'loading' });

export function useOgImage(): OgImageState {
  return useContext(OgImageContext);
}

// A data URL carries the bytes themselves, so the cached value needs no release when it goes.
function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new AppError('UNEXPECTED', 'The image could not be read.'));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fetchOpenGraphImage(signal: AbortSignal): Promise<string> {
  try {
    const response = await fetch(OPEN_GRAPH_IMAGE.path, { signal });
    if (!response.ok) {
      throw new AppError('API_REQUEST_FAILED', 'The Open Graph route did not return an image.', {
        path: OPEN_GRAPH_IMAGE.path,
        status: response.status,
      });
    }
    return await readAsDataUrl(await response.blob());
  } catch (error) {
    // An abort is the page closing, not a failure worth reporting.
    if (!signal.aborted) {
      captureException(error, { op: 'admin.brand.open-graph-image', path: OPEN_GRAPH_IMAGE.path });
    }
    throw error;
  }
}

export function OgImageProvider({ children }: { children: React.ReactNode }) {
  const image = useQuery({
    queryKey: adminQueryKeys.openGraphImage(),
    queryFn: ({ signal }) => fetchOpenGraphImage(signal),
    // Each visit shows what the route returns now, so a fixed generator shows at once.
    gcTime: 0,
    retry: false,
  });
  const state: OgImageState = image.isError
    ? { kind: 'failed' }
    : image.data === undefined
      ? { kind: 'loading' }
      : { kind: 'ready', src: image.data };
  return <OgImageContext.Provider value={state}>{children}</OgImageContext.Provider>;
}
