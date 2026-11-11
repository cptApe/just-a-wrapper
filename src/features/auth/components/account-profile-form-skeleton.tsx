import { SettingsAvatarHeroSkeleton } from '@/components/settings/settings-avatar-hero-skeleton';
import { SettingsDetailRowSkeleton } from '@/components/settings/settings-detail-row-skeleton';
import { SettingsSection } from '@/components/settings/settings-section';

// Loading twin of AccountProfileForm (account-profile-form.tsx): the same outer
// flex-col, the hero block's pb-12, and the two real SettingsSections beneath.
// The section titles ("Personal details", "Manage account") and the row labels
// are static chrome so they render real — only the person's name/email and
// avatar pulse. "Delete account" is fully static (label + value), so that row
// shows real text with just its destructive action reserved.
export function AccountProfileFormSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading account">
      <div className="flex flex-col items-start gap-3 pb-12 max-md:pb-0">
        <SettingsAvatarHeroSkeleton secondary />
      </div>

      <SettingsSection title="Personal details" divided={false}>
        <SettingsDetailRowSkeleton
          layout="stacked"
          label="Name"
          trailing="Edit"
          valueWidth="10rem"
        />
        <SettingsDetailRowSkeleton
          layout="stacked"
          label="Email"
          trailing="Edit"
          valueWidth="14rem"
        />
      </SettingsSection>

      <SettingsSection title="Manage account" divided={false}>
        <SettingsDetailRowSkeleton
          layout="stacked"
          label="Delete account"
          value="Permanently delete your account"
          trailing="Delete"
          destructive
        />
      </SettingsSection>
    </div>
  );
}
