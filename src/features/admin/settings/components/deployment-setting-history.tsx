import { AdminRowList, AdminValueRow } from '@/components/admin/admin-rows';
import type { SettingSource } from '@/lib/deployment-settings/registry';

export type SettingChange = { label: string; by: string; at: string };

/** Says whether the console, the environment or the built-in value decides a setting. */
export function SettingSourceNote({
  source,
  envKey,
  fallbackNote,
  verb,
}: {
  source: SettingSource;
  envKey: string;
  /** What the built-in value is, when neither the console nor env sets it. */
  fallbackNote: string;
  /** How the control changes the value: picking an option, or saving a typed one. */
  verb: 'Choosing' | 'Saving';
}) {
  const override = `${verb} here overrides it.`;
  return (
    <p className="text-meta text-muted-foreground">
      {source === 'stored'
        ? `Set here. It overrides ${envKey}.`
        : source === 'env'
          ? `From ${envKey}. ${override}`
          : `${fallbackNote}, because ${envKey} is not set. ${override}`}
    </p>
  );
}

/** The newest changes to a setting: when, who, and the value they chose. */
export function SettingChangeList({ changes }: { changes: readonly SettingChange[] }) {
  if (changes.length === 0) return null;
  return (
    <AdminRowList>
      {changes.map((change) => (
        <AdminValueRow
          key={`${change.at}-${change.label}`}
          label={`${change.at} · ${change.by}`}
          value={change.label}
        />
      ))}
    </AdminRowList>
  );
}
