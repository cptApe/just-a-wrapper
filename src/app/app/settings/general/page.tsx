import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Boundary } from '@/components/layouts/boundary';
import { ErrorState } from '@/components/layouts/error-state';
import { SettingsPageHeader } from '@/components/settings/settings-page-header';
import { SettingsSection } from '@/components/settings/settings-section';
import { getTimePreferences } from '@/features/preferences/api/get-preferences';
import { PreferenceRows } from '@/features/preferences/components/preference-rows';
import {
  updateReplyLanguageAction,
  updateTimeFormatAction,
  updateTimeZoneAction,
} from '@/features/settings/api/preference-actions';
import { brand } from '@/lib/brand/identity';
import { withRequestContext } from '@/lib/request-context';
import { TimeRowsSkeleton } from './general-page-skeleton';

export const metadata: Metadata = {
  title: `General · ${brand.name}`,
};

// /settings/general — the personal "how the app behaves for me" page. Theme is
// NOT here: it lives in the account popover (sidebar-footer.tsx), on every page.
// What remains is language & region, in an edit-row pattern (each setting is
// a row that states its current value, Edit expands the control, Save persists):
// agent language, time zone and time format are real controls persisted to the
// member's Better Auth user row (src/features/preferences). The live controls
// read their stored value server-side, so a slow read shows a skeleton and a failed one an ErrorState —
// the rows themselves own the per-save states.
export default function GeneralSettingsPage() {
  return (
    // Use the shell’s standard page width and padding; md:pt-8 aligns the title.
    <div className="w-full md:pt-8">
      <SettingsPageHeader title="General" />
      <div className="pt-8">
        <SettingsSection title="Language &amp; region" divided={false}>
          <Boundary loading={<TimeRowsSkeleton />} error={<TimeRowsError />}>
            <TimeRowsLoader />
          </Boundary>
        </SettingsSection>
      </div>
    </div>
  );
}

async function TimeRowsLoader() {
  const prefs = await withRequestContext({ route: 'settings-general-page' }, async () =>
    getTimePreferences(await headers()),
  );
  return (
    <PreferenceRows
      timezone={prefs.timezone}
      browserTimezone={prefs.browserTimezone}
      timeFormat={prefs.timeFormat}
      replyLanguage={prefs.replyLanguage}
      actions={{
        saveTimeZone: updateTimeZoneAction,
        saveReplyLanguage: updateReplyLanguageAction,
        saveTimeFormat: updateTimeFormatAction,
      }}
    />
  );
}

function TimeRowsError() {
  return (
    <div className="py-5">
      <ErrorState
        title="Couldn’t load your preferences"
        message="Something went wrong reading your time settings. Reload the page to try again."
      />
    </div>
  );
}
