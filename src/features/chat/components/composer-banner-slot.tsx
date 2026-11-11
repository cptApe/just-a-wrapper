'use client';

import { IconXClose } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { WarningBar } from '@/components/ui/warning-bar';
import { cn } from '@/lib/utils';
import { useActiveComposerBanner } from '../hooks/use-composer-banner';
import { dismissComposerBanner } from '../lib/composer-banner-store';

// Render the highest-priority persistent condition directly above the composer.
// No candidate means no layout space. Keep the banner in normal flow so the
// flexible thread absorbs its height; callers control outer spacing.
export function ComposerBannerSlot({
  className,
  omit,
}: {
  className?: string;
  /** A banner the page already explains with a richer surface. */
  omit?: string;
}) {
  const banner = useActiveComposerBanner(omit);
  if (!banner) return null;

  return (
    <div className={cn('px-4', className)}>
      <WarningBar
        role="alert"
        data-testid="composer-banner"
        data-banner-id={banner.id}
        icon={banner.icon}
        message={banner.message}
        className="mx-auto w-full max-w-3xl duration-150 animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
        action={
          <>
            {banner.action ? (
              <Button
                type="button"
                size="sm"
                onClick={banner.action.onSelect}
                data-testid="composer-banner-action"
              >
                {banner.action.label}
              </Button>
            ) : null}
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Dismiss"
              className="-mr-1"
              onClick={() => {
                banner.onDismiss?.();
                dismissComposerBanner(banner.id);
              }}
              data-testid="composer-banner-dismiss"
            >
              <IconXClose className="size-4" />
            </Button>
          </>
        }
      />
    </div>
  );
}
