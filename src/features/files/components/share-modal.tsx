'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { IconCheck, IconCopy01, IconRefreshCcw01, IconTrash01 } from '@/components/icons';
import { useOrganizationId } from '@/components/providers/app-providers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { useCopy } from '@/components/ui/hooks/use-copy';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AppError } from '@/lib/errors';
import { optimisticMutation } from '@/lib/optimistic-mutation';
import { fileQueryKeys } from '../api/keys';
import { createShare, listShares, revokeShare } from '../api/shares';
import type { ShareMode, ShareSummary, ShareTarget } from '../types';

// Links belong to exactly one target. Files allow viewing; folder owners may enable uploads.

const SHARE_MODE_LABELS: Record<ShareMode, string> = { view: 'View only', edit: 'Can upload' };

const EXPIRY_OPTIONS: Array<{ label: string; days: number | null }> = [
  { label: 'Never', days: null },
  { label: '1 day', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
];

export function ShareModal({
  open,
  target,
  canCreateEditShare,
  onOpenChange,
}: {
  open: boolean;
  target: ShareTarget;
  canCreateEditShare: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<ShareMode>('view');
  const [expiryDays, setExpiryDays] = useState<number | null>(null);
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const queryKey =
    organizationId === null
      ? fileQueryKeys.unscoped()
      : fileQueryKeys.shares(
          organizationId,
          target.kind === 'file' ? target.fileId : target.folderPath,
        );
  const links = useQuery({
    queryKey,
    enabled: open && organizationId !== null,
    staleTime: 0,
    queryFn: async () => {
      const response = await listShares(target);
      if (!response.ok) throw new AppError('API_REQUEST_FAILED', response.message, {});
      return response.data;
    },
  });
  const loading = links.isPending;
  const loadError = links.isError ? 'Couldn’t load existing links.' : null;
  const shares = links.data ?? [];
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const link = useCopy({
    getText: () => createdUrl ?? '',
    op: 'copy-share-link',
    context: undefined,
    successToast: undefined,
    failureToast: 'Copy failed. Select and copy manually',
  });
  const [pending, startTransition] = useTransition();
  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const res = await revokeShare(id);
      if (!res.ok) throw new AppError('API_REQUEST_FAILED', res.message);
    },
    ...optimisticMutation(queryClient, {
      root: queryKey,
      apply: (id: string) =>
        void queryClient.setQueryData<ShareSummary[]>(queryKey, (old) =>
          old?.filter((share) => share.id !== id),
        ),
      failure: (error) => ({ message: 'Could not revoke', description: error.message }),
    }),
    onSuccess: () => {
      toast.success('Link revoked');
    },
  });

  const targetLabel =
    target.kind === 'file'
      ? target.filename
      : target.folderPath === '/'
        ? 'All files'
        : target.folderPath;
  const allowEdit = target.kind === 'folder' && canCreateEditShare;
  const effectiveMode: ShareMode = allowEdit ? mode : 'view';

  function handleCreate() {
    startTransition(async () => {
      const res = await createShare({
        target,
        mode: effectiveMode,
        expiresInDays: expiryDays,
      });
      if (!res.ok) {
        toast.error('Could not create link', { description: res.message });
        return;
      }
      setCreatedUrl(res.data.url);
      await queryClient.invalidateQueries({ queryKey });
      toast.success('Share link created');
    });
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} size="sm">
      <ModalHeader>
        {/* The name sits on its own truncated line so a long filename never
            wraps the title across the header. */}
        <ModalTitle>{target.kind === 'file' ? 'Share file' : 'Share folder'}</ModalTitle>
        <ModalDescription className="truncate" title={targetLabel}>
          {targetLabel}
        </ModalDescription>
      </ModalHeader>
      <ModalContent>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Access</Label>
            {/* Files have one access level, so only folders get the choice. */}
            {target.kind === 'folder' ? (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={effectiveMode === 'view' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setMode('view')}
                >
                  {SHARE_MODE_LABELS.view}
                </Button>
                {allowEdit ? (
                  <Button
                    type="button"
                    variant={effectiveMode === 'edit' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setMode('edit')}
                    data-testid="share-mode-edit"
                  >
                    {SHARE_MODE_LABELS.edit}
                  </Button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        className="rounded-button outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="w-full"
                          disabled
                          data-testid="share-mode-edit"
                        >
                          {SHARE_MODE_LABELS.edit}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      Only workspace owners, admins, and the folder creator can create upload links
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            ) : null}
            <p className="text-meta font-medium text-muted-foreground">
              {effectiveMode === 'view'
                ? target.kind === 'file'
                  ? 'Anyone with the link can see and download this file.'
                  : 'Anyone with the link can see and download the files.'
                : 'Anyone with the link can also upload into this folder.'}
            </p>
          </div>

          <Form
            onSubmit={(event) => {
              event.preventDefault();
              if (!pending && !loading) handleCreate();
            }}
            className="flex items-end gap-2"
          >
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="share-expires">Expires</Label>
              <Select
                value={String(expiryDays)}
                onValueChange={(v) => setExpiryDays(v === 'null' ? null : Number(v))}
              >
                <SelectTrigger id="share-expires">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((o) => (
                    <SelectItem key={o.label} value={String(o.days)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" size="sm" disabled={pending || loading}>
              Create link
            </Button>
          </Form>

          {createdUrl && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
              <Input
                readOnly
                aria-label="Share link"
                value={createdUrl}
                className="h-8 text-meta font-medium"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8 shrink-0"
                onClick={link.copy}
                aria-label="Copy link"
              >
                {link.copyState === 'copied' ? (
                  <IconCheck className="size-4" />
                ) : (
                  <IconCopy01 className="size-4" />
                )}
              </Button>
            </div>
          )}

          {loadError ? (
            <div className="flex items-center justify-between gap-3" role="alert">
              <p className="text-meta text-destructive">{loadError}</p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="shrink-0"
                onClick={() => {
                  void links.refetch();
                }}
              >
                <IconRefreshCcw01 className="size-3.5" />
                Try again
              </Button>
            </div>
          ) : null}

          {loading ? (
            <p role="status" className="text-meta text-muted-foreground">
              Loading links…
            </p>
          ) : null}
          {!loading && !loadError && shares.length === 0 ? (
            <p className="text-meta text-muted-foreground">No links yet.</p>
          ) : null}
          {!loading && !loadError && shares.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>Existing links</Label>
              <ul className="flex flex-col gap-1.5">
                {shares.map((s) => {
                  const state = s.state;
                  return (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-meta font-medium"
                    >
                      <span className="flex items-center gap-2">
                        <Badge variant={s.mode === 'edit' ? 'default' : 'muted'}>
                          {SHARE_MODE_LABELS[s.mode]}
                        </Badge>
                        <span
                          className={
                            state === 'live' ? 'text-muted-foreground' : 'text-destructive'
                          }
                        >
                          {state}
                        </span>
                      </span>
                      {state === 'live' && s.canRevoke && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          onClick={() => revoke.mutate(s.id)}
                          disabled={pending}
                          aria-label="Revoke link"
                        >
                          <IconTrash01 className="size-3.5" />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </ModalContent>
    </Modal>
  );
}
