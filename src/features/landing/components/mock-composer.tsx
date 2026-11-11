import { IconArrowUp, IconMicrophone01, IconPlus } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { composerCardClass, composerCardInnerClass } from '@/features/chat/lib/composer-geometry';
import { cn } from '@/lib/utils';

/** The composer at rest, on the geometry the real one shares with its skeleton. */
export function MockComposer({
  placeholder,
  className,
}: {
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn(composerCardClass, 'border-alpha-8', className)}>
      <div className={composerCardInnerClass}>
        <div className="flex min-h-9 flex-col justify-center">
          <span className="truncate p-1 text-body-lg leading-6 text-foreground-tertiary">
            {placeholder}
          </span>
        </div>
        <div className="flex w-full items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="icon-sm" className="max-md:size-11">
            <IconPlus className="size-[18px]" />
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="icon-sm" className="max-md:size-11">
              <IconMicrophone01 className="size-4" />
            </Button>
            <Button type="button" size="icon-sm" disabled className="max-md:size-11">
              <IconArrowUp className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
