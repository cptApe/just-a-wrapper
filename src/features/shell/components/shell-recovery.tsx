'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { ShellWorkspace } from '../types';
import { WorkspaceSwitcher } from './workspace-switcher';

export function ShellRecovery({ workspaces }: { workspaces: ShellWorkspace[] }) {
  const router = useRouter();
  const active = workspaces.find((workspace) => workspace.isActive);
  return (
    <main className="flex min-h-dvh flex-col gap-8 bg-background p-6 text-foreground">
      <WorkspaceSwitcher
        workspaces={workspaces}
        activeName={active ? active.name : 'Workspace'}
        collapsed={false}
      />
      <section className="mx-auto my-auto flex max-w-md flex-col gap-4">
        <h1 className="text-title-section">Your workspace could not open</h1>
        <p className="text-body text-muted-foreground">
          Try again or choose another workspace above.
        </p>
        <div className="flex gap-3">
          <Button onClick={() => router.refresh()}>Try again</Button>
          <Button variant="secondary" asChild>
            <Link href="/app/settings">Settings</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
