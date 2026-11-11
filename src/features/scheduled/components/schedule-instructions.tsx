'use client';
import { Textarea } from '@/components/ui/textarea';
import type { AgentTier } from '@/features/agents/types';
import type { useScheduleAttachments } from '../hooks/use-schedule-attachments';
import { SchedulePromptFrame } from './schedule-prompt-frame';
import { ScheduleTierSelect } from './schedule-tier-select';
export function ScheduleInstructions({
  attachments,
  description,
  setDescription,
  tier,
  setTier,
}: {
  attachments: ReturnType<typeof useScheduleAttachments>;
  description: string;
  setDescription: (value: string) => void;
  tier: AgentTier;
  setTier: (value: AgentTier) => void;
}) {
  return (
    <SchedulePromptFrame
      attachments={attachments}
      tierSelect={<ScheduleTierSelect tier={tier} onChange={setTier} />}
    >
      <Textarea
        id="schedule-prompt"
        aria-label="Prompt"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Read my unread emails and summarize…"
        className="min-h-24 resize-none bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        rows={3}
        maxLength={8000}
      />
    </SchedulePromptFrame>
  );
}
