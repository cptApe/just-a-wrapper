import { redirect } from 'next/navigation';

// /app/settings has no content of its own — Account is the first page in the
// rail, so the bare url lands there.
export default function SettingsIndexPage() {
  redirect('/app/settings/account');
}
