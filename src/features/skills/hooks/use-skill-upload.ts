'use client';

import { useReducer } from 'react';
import { toast } from 'sonner';
import { AppError } from '@/lib/errors';
import { isExpectedUserStateError } from '@/lib/expected-state-error';
import { captureException } from '@/lib/observability-client';
import { useCreateSkill } from '../api/use-skill-mutations';
import { parseSkillFrontmatter, SKILL_ENTRY_FILE } from '../lib/skill-files';
import { reduceUpload } from '../lib/upload-machine';
import { skillFilesFromZip } from '../lib/zip-intake';

export function useSkillUpload() {
  const createSkill = useCreateSkill();
  const [stage, dispatch] = useReducer(reduceUpload, { kind: 'closed' });

  async function intakeZip(file: File) {
    if (stage.kind === 'saving') return;
    const token = crypto.getRandomValues(new Uint32Array(4)).join('-');
    dispatch({ type: 'read', attempt: token });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = skillFilesFromZip(bytes);
      const entry = result.files.find((f) => f.path === SKILL_ENTRY_FILE);
      const frontmatter = entry ? parseSkillFrontmatter(entry.content) : null;
      const suggestedName = result.suggestedName ?? file.name.replace(/\.zip$/i, '');
      dispatch({
        type: 'loaded',
        attempt: token,
        review: {
          files: result.files,
          name: frontmatter?.name ?? suggestedName,
          description: frontmatter?.description ?? '',
        },
      });
    } catch (error) {
      dispatch({ type: 'readFailed', attempt: token });
      if (!isExpectedUserStateError(error)) captureException(error, { op: 'skill-zip-intake' });
      // No review modal is open yet, so zip errors show as a toast.
      toast.error(error instanceof AppError ? error.message : 'Couldn’t read the zip file.');
    }
  }

  async function save() {
    if (stage.kind !== 'review' || stage.name.trim() === '') return;
    const token = crypto.getRandomValues(new Uint32Array(4)).join('-');
    dispatch({ type: 'save', attempt: token });
    try {
      // The mutation refreshes the confirmed list; this menu owns review and saving.
      const skill = await createSkill.mutateAsync({
        name: stage.name.trim(),
        description: stage.description.trim() || undefined,
        files: stage.files,
      });
      toast.success(`“${skill.name}” added to your skills.`);
      dispatch({ type: 'saved', attempt: token });
    } catch (cause) {
      captureException(cause, { op: 'skill-zip-create' });
      // The route puts the human-readable reason in the error body; fetchJson
      // surfaces it as `serverMessage`. Prefer it over the generic AppError text
      // so validation failures remain actionable.
      const serverMessage =
        cause instanceof AppError && typeof cause.context.serverMessage === 'string'
          ? cause.context.serverMessage
          : undefined;
      toast.error('Couldn’t add the skill. Try again.', {
        description: serverMessage ?? (cause instanceof Error ? cause.message : undefined),
      });
      dispatch({ type: 'failed', attempt: token });
    }
  }

  return {
    stage,
    change: (name: string, description: string) => dispatch({ type: 'edit', name, description }),
    close: () => dispatch({ type: 'close' }),
    intakeZip,
    save,
  };
}
