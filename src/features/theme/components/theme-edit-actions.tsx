'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { AdminStatusBanner } from '@/components/admin/status-banner';
import { IconBrush01 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useThemeEditState } from '../hooks/use-theme-edit-state';
import {
  activateThemeEdit,
  discardThemeEditDraft,
  pruneThemeEditDraft,
} from '../lib/theme-edit-storage';
import { hasThemeEdits } from '../lib/theme-values';

const APP_HREF = '/app';

export function ThemeEditButton() {
  const router = useRouter();
  return (
    <Button
      type="button"
      size="lg"
      className="text-body-lg"
      onClick={() => {
        activateThemeEdit();
        router.push(APP_HREF);
      }}
    >
      <IconBrush01 aria-hidden className="size-5" />
      Edit
    </Button>
  );
}

export function ThemeEditBanner({ tokenNames }: { tokenNames: readonly string[] }) {
  const state = useThemeEditState();
  // Keep the draft accurate against the current token list before deciding
  // whether there is a draft to talk about.
  React.useEffect(() => {
    pruneThemeEditDraft(tokenNames);
  }, [tokenNames]);
  if (state.active) {
    return (
      <AdminStatusBanner
        tone="attention"
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href={APP_HREF}>Resume editing</Link>
          </Button>
        }
      >
        Edit mode is active in the app
      </AdminStatusBanner>
    );
  }
  if (hasThemeEdits(state)) {
    return (
      <AdminStatusBanner
        tone="attention"
        action={
          <Button type="button" variant="ghost" size="sm" onClick={discardThemeEditDraft}>
            Discard draft
          </Button>
        }
      >
        A draft from your last edit session is saved. Edit restores it.
      </AdminStatusBanner>
    );
  }
  return null;
}
