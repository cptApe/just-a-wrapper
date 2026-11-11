'use client';
import { createContext, useContext } from 'react';
import { AppError } from '@/lib/errors';

type SchedulesCapability = { emailEnabled: boolean };

const SchedulesContext = createContext<SchedulesCapability | null>(null);
export function SchedulesCapabilityProvider({
  emailEnabled,
  children,
}: {
  emailEnabled: boolean;
  children: React.ReactNode;
}) {
  return <SchedulesContext value={{ emailEnabled }}>{children}</SchedulesContext>;
}
function useSchedulesCapability(): SchedulesCapability {
  const capability = useContext(SchedulesContext);
  if (capability === null)
    throw new AppError('UNEXPECTED', 'SchedulesCapabilityProvider is missing', {});
  return capability;
}
export function useScheduleEmailEnabled(): boolean {
  return useSchedulesCapability().emailEnabled;
}
