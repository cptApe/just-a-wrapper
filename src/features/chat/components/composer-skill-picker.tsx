'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { IconCheck, IconGrid01 } from '@/components/icons';
import { useOrganizationId } from '@/components/providers/app-providers';
import { Button } from '@/components/ui/button';
import { ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import type { ComposerSkill } from '@/features/sessions/types';
import { cn } from '@/lib/utils';
import { chatQueryKeys } from '../api/keys';
import { listComposerSkills } from '../api/skills-picker';
import { PickerEmpty, PickerError } from './composer-picker-states';

// The "Use skills" body of the shared attach canvas (one Modal instance in
// ComposerAttachCanvas — this renders its header/content/footer, not its own
// overlay). Skills are references on the opening message and several can be
// named at once, so this is multi-select: clicking a row toggles it
// independently, confirm attaches every picked skill. The body opens with the
// currently attached skills preselected (passed down from the composer), and
// confirming REPLACES the whole set. Each selected row carries a trailing check
// (label left, check right — no reserved left slot, size-4 to match the shared
// DropdownMenuCheckItem), matching the permission select.

const SKELETON_ROWS = [0, 1, 2, 3, 4];

export function ComposerSkillCanvasBody({
  sessionId,
  initialSelectedIds,
  onConfirm,
  onClose,
}: {
  /** The task whose agent the skills must load into; undefined for a new chat on Home. */
  sessionId: string | undefined;
  /** Ids of the skills already attached, so reopening shows them selected. */
  initialSelectedIds: string[];
  onConfirm: (skills: ComposerSkill[]) => void;
  onClose: () => void;
}) {
  // Each open reads the live skill list, so nothing is cached past this canvas.
  const skillsQuery = useQuery({
    queryKey: chatQueryKeys.composerSkills(useOrganizationId(), sessionId),
    queryFn: () => listComposerSkills(sessionId),
    staleTime: 0,
    gcTime: 0,
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(initialSelectedIds));
  const skills = skillsQuery.data ?? EMPTY_SKILLS;

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const confirm = useCallback(() => {
    // Confirm REPLACES the selection, so an empty confirm clears earlier picks
    // instead of silently keeping them.
    onConfirm(skills.filter((skill) => selectedIds.has(skill.id)));
    onClose();
  }, [skills, selectedIds, onConfirm, onClose]);

  return (
    <>
      <ModalHeader align="start">
        <ModalTitle>Use skills</ModalTitle>
      </ModalHeader>
      <ModalContent className="px-4">
        {skillsQuery.isPending ? (
          <div aria-busy="true" aria-label="Loading skills" className="flex flex-col gap-1 pt-2">
            {SKELETON_ROWS.map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl px-2.5 py-2.5">
                <div className="size-8 shrink-0 animate-pulse rounded-lg bg-alpha-6" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="h-3.5 w-1/3 animate-pulse rounded-sm bg-alpha-6" />
                  <div className="h-3 w-2/3 animate-pulse rounded-sm bg-alpha-6" />
                </div>
              </div>
            ))}
          </div>
        ) : skillsQuery.isError ? (
          <PickerError
            message="Your skills didn’t load."
            onRetry={() => void skillsQuery.refetch()}
          />
        ) : skills.length === 0 ? (
          <PickerEmpty
            icon={IconGrid01}
            title="No skills yet"
            hint="Create a skill on the Tools page and it’ll be available here."
          />
        ) : (
          <ul className="flex flex-col gap-0.5 pt-1">
            {skills.map((skill) => {
              const selected = selectedIds.has(skill.id);
              return (
                <li key={skill.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(skill.id)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left',
                      'hover:bg-alpha-6',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                      selected && 'bg-alpha-6',
                    )}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-alpha-8 text-muted-foreground">
                      <IconGrid01 className="size-4" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-title-card font-medium text-foreground">
                        {skill.name}
                      </span>
                      {skill.description ? (
                        <span className="truncate text-meta text-muted-foreground">
                          {skill.description}
                        </span>
                      ) : null}
                    </span>
                    <IconCheck
                      className={cn(
                        'size-4 shrink-0 self-center text-foreground',
                        selected ? 'opacity-100' : 'opacity-0',
                      )}
                      aria-hidden
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ModalContent>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={confirm}
          disabled={
            !skillsQuery.isSuccess || (selectedIds.size === 0 && initialSelectedIds.length === 0)
          }
        >
          Attach skills
        </Button>
      </ModalFooter>
    </>
  );
}

const EMPTY_SKILLS: ComposerSkill[] = [];
