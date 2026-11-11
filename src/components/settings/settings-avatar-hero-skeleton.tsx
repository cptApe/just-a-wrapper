import { Skeleton } from '@/components/ui/skeleton';

// Match the real hero’s title and secondary line boxes so loading never shifts the identity block.
export function SettingsAvatarHeroSkeleton({ secondary = false }: { secondary?: boolean }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <Skeleton className="size-20 max-sm:size-24 rounded-full" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <div
          data-skeleton="name"
          className="flex h-[var(--text-title-page--line-height)] items-center"
        >
          <Skeleton className="h-6 w-44 rounded-sm" />
        </div>
        {secondary ? (
          <div className="flex h-[22px] items-center">
            <Skeleton className="h-4 w-56 rounded-sm" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
