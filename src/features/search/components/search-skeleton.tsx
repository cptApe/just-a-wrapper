import { Skeleton } from '@/components/ui/skeleton';

export function SearchSkeleton() {
  return (
    <div role="status" aria-label="Searching" className="px-6 py-2">
      {['w-3/5', 'w-2/5', 'w-4/5', 'w-1/2', 'w-3/5', 'w-2/5'].map((width, index) => (
        <div key={`${width}-${index}`} aria-hidden className="flex h-10 items-center gap-3">
          <Skeleton className="size-5 shrink-0 rounded-sm" />
          <Skeleton className={`h-4 ${width}`} />
        </div>
      ))}
    </div>
  );
}
