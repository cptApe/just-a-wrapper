import { Skeleton } from '@/components/ui/skeleton';

export function OfficePreviewSkeleton({ filename }: { filename: string }) {
  return (
    <div
      className="flex h-full min-h-[240px] flex-col gap-4 rounded-lg border p-6"
      aria-busy="true"
      aria-label={`Loading ${filename}`}
    >
      <Skeleton className="h-7 w-2/5" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="mt-4 h-28 w-full" />
    </div>
  );
}
