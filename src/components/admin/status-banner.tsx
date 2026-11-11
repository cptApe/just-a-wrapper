import { IconAlertTriangle, IconCheckCircle } from '@/components/icons';
import { cn } from '@/lib/utils';

type BannerTone = 'ready' | 'attention';

const TONE_CLASSES: Record<BannerTone, string> = {
  ready: 'border-success/30 bg-success-soft',
  attention: 'border-warning/30 bg-warning-soft',
};

const TONE_ICON = {
  ready: IconCheckCircle,
  attention: IconAlertTriangle,
} satisfies Record<BannerTone, typeof IconCheckCircle>;

const TONE_ICON_CLASSES: Record<BannerTone, string> = {
  ready: 'text-success',
  attention: 'text-warning',
};

export function AdminStatusBanner({
  tone,
  children,
  action,
}: {
  tone: BannerTone;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const Icon = TONE_ICON[tone];

  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-3 rounded-xl border px-4 py-4 sm:flex-row sm:items-center',
        TONE_CLASSES[tone],
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Icon aria-hidden className={cn('size-5 shrink-0', TONE_ICON_CLASSES[tone])} />
        <div className="min-w-0 text-title-card text-foreground">{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
