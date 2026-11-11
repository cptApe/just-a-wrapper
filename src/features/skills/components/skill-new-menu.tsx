'use client';

import { useRef } from 'react';
import { IconChevronDown, IconMessageChatCircle, IconUploadCloud01 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { useCreateSkillTask } from '../hooks/use-create-skill-task';
import { useSkillUpload } from '../hooks/use-skill-upload';
import { SkillUploadReview } from './skill-upload-review';

const NEW_MENU_WIDTH = 'min-w-[200px]';
export function SkillNewMenu() {
  const upload = useSkillUpload();
  const { intakeZip } = upload;
  const { createWithAgent, startingChat } = useCreateSkillTask();
  const fileInput = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" className="shrink-0">
            New
            <IconChevronDown className="size-3.5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={NEW_MENU_WIDTH}>
          <DropdownMenuItem onSelect={() => void createWithAgent()} disabled={startingChat}>
            <IconMessageChatCircle className="size-4" />
            Create with Agent
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              // Radix restores focus to the trigger on close; opening the OS
              // file picker in the same tick races that, so defer to the next.
              setTimeout(() => fileInput.current?.click(), 0);
            }}
          >
            <IconUploadCloud01 className="size-4" />
            Upload a .zip
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={fileInput}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        aria-label="Skill zip file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void intakeZip(file);
        }}
      />

      <SkillUploadReview
        stage={upload.stage}
        onChange={upload.change}
        onClose={upload.close}
        onSave={upload.save}
      />
    </>
  );
}
