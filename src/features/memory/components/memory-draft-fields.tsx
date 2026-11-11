'use client';

import { useEffect, useRef } from 'react';
import { IconAlertCircle } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { MEMORY_EDIT_CONFLICT_MESSAGE } from '../constants';
import { MarkdownEditor } from './markdown-editor';

export function MemoryDraftFields({
  draft,
  conflict,
  saving,
  reloading,
  label,
  onChange,
  onReload,
}: {
  draft: string;
  conflict: boolean;
  saving: boolean;
  reloading: boolean;
  label: string;
  onChange: (draft: string) => void;
  onReload: () => Promise<void>;
}) {
  const conflictBannerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (conflict) conflictBannerRef.current?.scrollIntoView({ block: 'nearest' });
  }, [conflict]);
  return (
    <div className="flex flex-col gap-3">
      {conflict ? (
        <div
          ref={conflictBannerRef}
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive-soft p-3 text-destructive"
        >
          <IconAlertCircle className="mt-0.5 size-4 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <p className="text-meta">{MEMORY_EDIT_CONFLICT_MESSAGE}</p>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void onReload()}
              disabled={reloading}
              aria-busy={reloading}
            >
              Reload
            </Button>
          </div>
        </div>
      ) : null}
      <MarkdownEditor
        value={draft}
        onChange={onChange}
        disabled={saving || reloading}
        ariaLabel={label}
        placeholder="Write what the agent should remember…"
      />
    </div>
  );
}
