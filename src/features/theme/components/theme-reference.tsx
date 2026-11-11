import { AdminSection } from '@/components/admin/admin-section';
import type { ThemeToken } from '../types';
import { ThemeCurrentLook } from './theme-current-look';
import { ThemeEditBanner, ThemeEditButton } from './theme-edit-actions';
import { ThemePreviewSection } from './theme-live-preview';

// The body of /admin/theme: one clear way into edit mode and a compact look at
// the real light and dark theme. Server-rendered; only the edit entry and the
// status row are client components.

export function ThemeReference({ tokens }: { tokens: ThemeToken[] }) {
  return (
    <>
      <AdminSection
        title="Edit in interactive mode"
        support="Change your theme while clicking around the app."
        action={<ThemeEditButton />}
      >
        <ThemeEditBanner tokenNames={tokens.map((token) => token.name)} />
      </AdminSection>
      <AdminSection title="Your look today" support="Edit variables below to preview a change.">
        <ThemeCurrentLook tokens={tokens} />
      </AdminSection>
      <ThemePreviewSection tokens={tokens} />
    </>
  );
}
