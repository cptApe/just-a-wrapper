'use client';
import { useState } from 'react';
import type { ReplyLanguage } from '../lib/reply-language';
import type { TimeFormat } from '../lib/time-preferences';
import type { SavePreferenceAction } from '../types';
import { ReplyLanguageRow } from './reply-language-row';
import { TimeFormatRow } from './time-format-row';
import { TimezoneRow } from './timezone-row';

// Opening one row cancels the other; the shared saved format keeps the timezone clock in sync immediately.
type OpenRow = 'replyLanguage' | 'timezone' | 'timeFormat' | null;

export function PreferenceRows({
  timezone: initialTimezone,
  browserTimezone,
  timeFormat: initialTimeFormat,
  replyLanguage: initialReplyLanguage,
  actions,
}: {
  timezone: string | null;
  browserTimezone: string | null;
  timeFormat: TimeFormat | null;
  replyLanguage: ReplyLanguage | null;
  /** The page's server actions: a saved zone or language also reaches the person's tasks. */
  actions: {
    saveTimeZone: SavePreferenceAction<string | null>;
    saveReplyLanguage: SavePreferenceAction<ReplyLanguage | null>;
    saveTimeFormat: SavePreferenceAction<TimeFormat>;
  };
}) {
  const [timezone, setTimezone] = useState(initialTimezone);
  const [timeFormat, setTimeFormat] = useState(initialTimeFormat);
  const [replyLanguage, setReplyLanguage] = useState(initialReplyLanguage);
  const [open, setOpen] = useState<OpenRow>(null);

  return (
    <>
      <ReplyLanguageRow
        value={replyLanguage}
        open={open === 'replyLanguage'}
        onOpenChange={(next) => setOpen(next ? 'replyLanguage' : null)}
        onSaved={setReplyLanguage}
        save={actions.saveReplyLanguage}
      />
      <TimezoneRow
        value={timezone}
        browserTimezone={browserTimezone}
        timeFormat={timeFormat}
        open={open === 'timezone'}
        onOpenChange={(next) => setOpen(next ? 'timezone' : null)}
        onSaved={setTimezone}
        save={actions.saveTimeZone}
      />
      <TimeFormatRow
        value={timeFormat}
        open={open === 'timeFormat'}
        onOpenChange={(next) => setOpen(next ? 'timeFormat' : null)}
        onSaved={setTimeFormat}
        save={actions.saveTimeFormat}
      />
    </>
  );
}
