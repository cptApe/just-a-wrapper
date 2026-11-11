'use client';

import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';

import type { ReviewStage } from '../lib/upload-machine';
export function SkillUploadReview({
  stage,
  onChange,
  onClose,
  onSave,
}: {
  stage: ReviewStage;
  onChange: (name: string, description: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const saving = stage.kind === 'saving';
  const reviewOpen = stage.kind === 'review' || stage.kind === 'saving';
  return (
    <Modal
      open={reviewOpen}
      onOpenChange={(next) => {
        if (!next && !saving) {
          onClose();
        }
      }}
    >
      <ModalHeader>
        <ModalTitle>New skill</ModalTitle>
      </ModalHeader>
      <Form
        onSubmit={(event) => {
          event.preventDefault();
          if (stage.kind === 'review' && stage.name.trim() !== '') onSave();
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <ModalContent className="gap-4">
          <ModalDescription>
            A skill is a folder of instructions the agent loads when a task matches, a way of
            working you teach once.
          </ModalDescription>

          {'files' in stage ? (
            <div className="flex flex-col gap-3">
              <div className="grid gap-2">
                <Label htmlFor="skill-new-name">Name</Label>
                <Input
                  id="skill-new-name"
                  value={stage.name}
                  onChange={(event) => onChange(event.target.value, stage.description)}
                  disabled={saving}
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="skill-new-description">Description</Label>
                <Input
                  id="skill-new-description"
                  value={stage.description}
                  onChange={(event) => onChange(stage.name, event.target.value)}
                  disabled={saving}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="flex flex-col gap-1 rounded-md bg-alpha-6 p-3">
                <p className="text-meta font-medium">{stage.files.length} files</p>
                <ul className="flex flex-col">
                  {stage.files.slice(0, 8).map((file) => (
                    <li
                      key={file.path}
                      className="truncate font-mono text-meta font-medium text-muted-foreground"
                    >
                      {file.path}
                    </li>
                  ))}
                  {stage.files.length > 8 ? (
                    <li className="text-meta font-medium text-muted-foreground">
                      +{stage.files.length - 8} more
                    </li>
                  ) : null}
                </ul>
              </div>
            </div>
          ) : null}
        </ModalContent>

        <ModalFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onClose();
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving || stage.kind !== 'review' || stage.name.trim() === ''}
          >
            {saving ? 'Adding…' : 'Add skill'}
          </Button>
        </ModalFooter>
      </Form>
    </Modal>
  );
}
