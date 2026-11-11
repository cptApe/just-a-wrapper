'use client';
import { createContext, useContext } from 'react';
import { AppError } from '@/lib/errors';

type DeploymentCapabilities = {
  billing: boolean;
  /** Plans are bought and changed in the app (subscription billing mode). */
  plansForSale: boolean;
  connectedApps: boolean;
};

const DeploymentCapabilitiesContext = createContext<DeploymentCapabilities | null>(null);

export function DeploymentCapabilitiesProvider({
  value,
  children,
}: {
  value: DeploymentCapabilities;
  children: React.ReactNode;
}) {
  return <DeploymentCapabilitiesContext value={value}>{children}</DeploymentCapabilitiesContext>;
}

function useDeploymentCapabilities(): DeploymentCapabilities {
  const value = useContext(DeploymentCapabilitiesContext);
  if (value === null)
    throw new AppError('UNEXPECTED', 'DeploymentCapabilitiesProvider is missing', {});
  return value;
}

export function useBillingEnabled(): boolean {
  return useDeploymentCapabilities().billing;
}

export function usePlansForSale(): boolean {
  return useDeploymentCapabilities().plansForSale;
}

export function useConnectedAppsEnabled(): boolean {
  return useDeploymentCapabilities().connectedApps;
}
