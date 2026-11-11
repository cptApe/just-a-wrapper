'use client';
import { createContext, useContext } from 'react';
import { AppError } from '@/lib/errors';

const MediaEnabledContext = createContext<boolean | null>(null);

export function MediaCapabilityProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return <MediaEnabledContext value={enabled}>{children}</MediaEnabledContext>;
}

export function useMediaEnabled(): boolean {
  const enabled = useContext(MediaEnabledContext);
  if (enabled === null)
    throw new AppError('UNEXPECTED', 'MediaCapabilityProvider is missing', {
      capability: 'media',
    });
  return enabled;
}
