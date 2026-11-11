'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useLayoutEffect, useState } from 'react';
import { PostHogIdentify } from './posthog-identify';

// The client data layer for the authed app. Mounted once in
// the /app segment layout, above both product shells and the ⌘K command menu,
// so the sidebar recents, command search, and integration actions share ONE
// QueryClient. Public and auth routes never mount this, so React Query stays out of
// their bundles.
//
// Live lists default to explicit invalidation. Search overrides these defaults
// with finite freshness and retention, and refreshes whenever the menu opens.
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        throwOnError: false,
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 2,
      },
    },
  });
}

// The active workspace (the Better Auth organization) is the multi-tenancy
// boundary every cache entry is scoped by. The client
// identifies a workspace by its organizationId; the server resolves that to the
// internal workspace row. Query keys root on this value so a workspace switch
// (which only does router.refresh(), NOT a full reload — the QueryClient
// persists) can never serve one workspace's cache to another.
const OrganizationIdContext = createContext<string | null>(null);

export function useOrganizationId(): string | null {
  return useContext(OrganizationIdContext);
}

// Public share pages supply their own value because they render outside the /app segment.
export function OrganizationIdProvider({
  value,
  children,
}: {
  value: string | null;
  children: React.ReactNode;
}) {
  return <OrganizationIdContext.Provider value={value}>{children}</OrganizationIdContext.Provider>;
}

// The signed-in viewer, provided by the (shell) layout for its subtree. The
// sidebar keys the Team group off the viewer id (own vs. teammates' shared
// tasks), and the optimistic "new task" row stamps itself with the viewer's
// identity so it lands with the same shape the server row will carry.
export type Viewer = { id: string; name: string | null; email: string; image: string | null };

const ViewerContext = createContext<Viewer | null>(null);

export function useViewer(): Viewer | null {
  return useContext(ViewerContext);
}

export function ViewerProvider({ value, children }: { value: Viewer; children: React.ReactNode }) {
  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

/** The admin console's data layer: the same client defaults, with no workspace to scope by. */
export function AdminDataProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function AppDataProviders({
  organizationId,
  onWorkspaceChange,
  children,
}: {
  /** The caller's active organizationId, resolved server-side in the layout. */
  organizationId: string | null;
  /** Clears client state that lives outside the QueryClient when the workspace changes. */
  onWorkspaceChange: () => void;
  children: React.ReactNode;
}) {
  // One client for the app's lifetime. useState initializer so React keeps the
  // same instance across re-renders (a fresh client per render would drop the
  // cache every time).
  const [queryClient] = useState(makeQueryClient);
  // Creation, leave and deletion can change the workspace without using the switcher.
  useLayoutEffect(
    () => () => {
      onWorkspaceChange();
      queryClient.clear();
    },
    [organizationId, queryClient, onWorkspaceChange],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <OrganizationIdProvider value={organizationId}>
        <PostHogIdentify />
        {children}
      </OrganizationIdProvider>
    </QueryClientProvider>
  );
}
