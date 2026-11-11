import { SettingsDetailRowSkeleton } from '@/components/settings/settings-detail-row-skeleton';
import { SettingsPageHeader } from '@/components/settings/settings-page-header';
import { SettingsSection } from '@/components/settings/settings-section';

// The /settings/general loading frames, shared by the route's loading.tsx and the
// page's in-page Boundary so both stages match the loaded page. The preference rows
// are the only data-backed content: their labels are static chrome (verbatim from
// the row components), so they render real through the real SettingsDetailRow
// layout, and only the value line pulses at its true footprint.

// The Language & region rows that read a stored value. Shared by the page's
// Boundary fallback and GeneralPageSkeleton.
export function TimeRowsSkeleton() {
  return (
    <>
      <SettingsDetailRowSkeleton
        layout="stacked"
        label="Agent language"
        trailing="Edit"
        valueWidth="9rem"
      />
      <SettingsDetailRowSkeleton
        layout="stacked"
        label="Time zone"
        trailing="Edit"
        valueWidth="18rem"
      />
      <SettingsDetailRowSkeleton
        layout="stacked"
        label="Time format"
        trailing="Edit"
        valueWidth="3.5rem"
      />
    </>
  );
}

export function GeneralPageSkeleton() {
  return (
    <div className="w-full md:pt-8" aria-busy="true" aria-label="Loading general settings">
      <SettingsPageHeader title="General" />
      <div className="pt-8">
        <SettingsSection title="Language & region" divided={false}>
          <TimeRowsSkeleton />
        </SettingsSection>
      </div>
    </div>
  );
}
