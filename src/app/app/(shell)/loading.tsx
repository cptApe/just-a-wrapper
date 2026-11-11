import { HomeViewSkeleton } from '@/features/chat/components/home-view-skeleton';

// Home loading paints the page frame while server reads resolve.
// This shell-group fallback also covers children without a nearer boundary;
// Library, Scheduled, Task and Tools provide their own.
export default function Loading() {
  return <HomeViewSkeleton />;
}
