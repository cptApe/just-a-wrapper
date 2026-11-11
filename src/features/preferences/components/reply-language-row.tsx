'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { SettingsDetailRow } from '@/components/settings/settings-detail-row';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { captureException } from '@/lib/observability-client';
import { parseReplyLanguage, REPLY_LANGUAGES, type ReplyLanguage } from '../lib/reply-language';
import type { SavePreferenceAction } from '../types';

const AUTO = 'auto';
const AUTO_LABEL = 'Match my messages';

export function ReplyLanguageRow({
  value,
  open,
  onOpenChange,
  onSaved,
  save,
}: {
  value: ReplyLanguage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (value: ReplyLanguage | null) => void;
  save: SavePreferenceAction<ReplyLanguage | null>;
}) {
  const [draft, setDraft] = useState<ReplyLanguage | null>(value);

  // Closing the row discards an unsaved choice.
  const [lastOpen, setLastOpen] = useState(open);
  if (lastOpen !== open) {
    setLastOpen(open);
    if (!open) setDraft(value);
  }

  return (
    <SettingsDetailRow
      layout="stacked"
      label="Agent language"
      value={value ?? AUTO_LABEL}
      helper="The language your agent replies in. The app itself stays in English."
      open={open}
      onOpenChange={onOpenChange}
      saveDisabled={draft === value}
      onSave={async () => {
        try {
          const saved = await save(draft);
          if (!saved.ok) {
            toast.error('Couldn’t save your agent language. Try again.', {
              description: saved.message,
            });
            return false;
          }
        } catch (cause) {
          captureException(cause, { feature: 'preferences-reply-language' });
          toast.error('Couldn’t save your agent language. Try again.');
          return false;
        }
        onSaved(draft);
        toast.success('Agent language saved');
        return true;
      }}
    >
      <Select
        value={draft ?? AUTO}
        onValueChange={(next) => setDraft(parseReplyLanguage(next === AUTO ? null : next))}
      >
        <SelectTrigger aria-label="Agent language" className="w-full max-w-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>{AUTO_LABEL}</SelectItem>
          {REPLY_LANGUAGES.map((language) => (
            <SelectItem key={language} value={language}>
              {language}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsDetailRow>
  );
}
