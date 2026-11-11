'use client';
// Import display config from its leaf so server-only APIs never enter the client bundle.
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { TIER_DISPLAY } from '@/features/agents/config';
import type { AgentTier } from '@/features/agents/types';
import { TASK_TIERS } from '@/features/tasks/constants';
export function ScheduleTierSelect({
  tier,
  onChange,
}: {
  tier: AgentTier;
  onChange: (tier: AgentTier) => void;
}) {
  return (
    <Select
      value={tier}
      onValueChange={(next) => {
        const chosen = TASK_TIERS.find((candidate) => candidate === next);
        if (chosen) onChange(chosen);
      }}
    >
      <SelectTrigger
        aria-label="Model"
        className="h-7 w-auto bg-transparent text-meta hover:bg-alpha-8"
      >
        {TIER_DISPLAY[tier].label}
      </SelectTrigger>
      <SelectContent>
        {TASK_TIERS.map((t) => (
          <SelectItem key={t} value={t} title={TIER_DISPLAY[t].description}>
            {TIER_DISPLAY[t].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
