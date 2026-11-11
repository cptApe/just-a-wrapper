'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { ADMIN_PROMPT_COPIED_TOAST } from '@/components/admin/constants';
import { IconX } from '@/components/icons';
import { useTheme } from '@/components/theme/theme-provider';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { TooltipProvider } from '@/components/ui/tooltip';
import { formatAdminPrompt } from '@/lib/admin-prompt';
import { useThemeEdits } from '../hooks/use-theme-edits';
import { themeEditPrompt } from '../lib/theme-edit-prompt';
import {
  deactivateThemeEdit,
  discardThemeEditDraft,
  updateThemeEditValues,
} from '../lib/theme-edit-storage';
import type { ThemeEditValues, ThemeToken } from '../types';
import { ThemeNamedControls } from './theme-named-controls';
import { ThemeSwitcher } from './theme-switcher';

const ADMIN_THEME_HREF = '/admin/theme';

// Only explicit exit ends editing; Escape must not discard the session, and exiting keeps its saved draft.
export function ThemeEditCard({
  tokens,
  values,
}: {
  tokens: ThemeToken[];
  values: ThemeEditValues;
}) {
  const router = useRouter();
  const { theme } = useTheme();
  // The card only mounts once the client store reports active, so `theme` is
  // already the resolved value here (no pre-hydration frame to guard).
  const mode = theme;
  const edits = useThemeEdits({
    tokens,
    mode,
    values,
  });

  function exit() {
    // Unmounting the card (active → false) removes every inline override.
    deactivateThemeEdit();
    router.push(ADMIN_THEME_HREF);
  }

  const changeCount = edits.changes.length;
  const [saveOpen, setSaveOpen] = React.useState(false);

  return (
    // ThemeEditMount lives beside AppShell, outside the shell's shared tooltip provider.
    <TooltipProvider delayDuration={300}>
      <Modal open presentation="canvas" floating resizable closable={false}>
        <ModalHeader
          align="start"
          controls={
            <div className="flex items-center gap-1">
              <ThemeSwitcher />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close theme editor"
                onClick={exit}
              >
                <IconX aria-hidden className="size-5" />
              </Button>
            </div>
          }
        >
          <ModalTitle>Theme</ModalTitle>
        </ModalHeader>
        <ModalContent className="px-4">
          <ThemeNamedControls
            tokens={tokens}
            values={values}
            mode={mode}
            onValuesChange={updateThemeEditValues}
            loadFonts
            onFontPreview={(preview) => {
              const root = document.documentElement.style;
              const font = tokens.find((token) => token.name === '--font-sans');
              if (!font) return;
              if (preview) root.setProperty(preview.name, preview.value);
              else if (edits.isEdited(font)) root.setProperty(font.name, edits.valueFor(font));
              else root.removeProperty(font.name);
            }}
          />
        </ModalContent>
        <ModalFooter
          left={
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={discardThemeEditDraft}
                disabled={!edits.hasEdits}
              >
                Reset
              </Button>
              {changeCount > 0 ? (
                <span className="text-meta text-muted-foreground tabular">
                  {changeCount} changed
                </span>
              ) : null}
            </div>
          }
        >
          <Button type="button" disabled={changeCount === 0} onClick={() => setSaveOpen(true)}>
            Save changes
          </Button>
          <SaveThemeDialog
            open={saveOpen}
            onOpenChange={setSaveOpen}
            prompt={formatAdminPrompt(themeEditPrompt(edits.changes))}
          />
        </ModalFooter>
      </Modal>
    </TooltipProvider>
  );
}

/** Saving means handing the change to the admin's coding agent: this console
    never writes code. Show the exact prompt so nothing is hidden. */
function SaveThemeDialog({
  open,
  onOpenChange,
  prompt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Save changes</DialogTitle>
          <DialogDescription>
            Paste this prompt to your agent. It makes the change.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <pre className="max-h-72 overflow-auto rounded-md bg-alpha-6 p-3 font-mono text-meta font-medium whitespace-pre-wrap">
            {prompt}
          </pre>
        </DialogBody>
        <DialogFooter>
          <CopyButton
            label="Copy prompt"
            accessibleLabel="Copy a prompt asking your agent to apply these theme changes"
            op="admin.copy-theme-edit-prompt"
            text={prompt}
            successToast={ADMIN_PROMPT_COPIED_TOAST}
            variant="primary"
            size="default"
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
