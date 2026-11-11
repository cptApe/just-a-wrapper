import { cn } from '@/lib/utils';

// The settings shell owns page width and padding; identity pages use the avatar hero instead of this title.
// Below md the phone top bar already names the page, so the title stays only
// for assistive technology. A header with no action then takes no space, and
// the top padding of the content after it drops too, so content starts at the
// shell's own top padding.
export function SettingsPageHeader({
  title,
  action,
}: {
  title: string;
  /** Optional trailing control on the title row (e.g. an "Add member" button). */
  action?: React.ReactNode;
}) {
  return (
    <header
      className={cn(
        'flex items-center justify-between gap-4',
        !action && 'max-md:sr-only max-md:[&+*]:pt-0',
      )}
    >
      <h1 className="text-title-page max-md:sr-only">{title}</h1>
      {action ? <div className="shrink-0 max-md:ml-auto">{action}</div> : null}
    </header>
  );
}
