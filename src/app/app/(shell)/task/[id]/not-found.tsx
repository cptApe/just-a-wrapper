import Link from 'next/link';
import { IconMessageXCircle } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

// Rendered when the task loader calls notFound() for an unknown or foreign
// session id. Sits inside the app shell (the sidebar stays), so the next click
// is right there. Copy names both real causes — the id doesn't exist, or it
// belongs to a workspace you're not in — without leaking which.
export default function TaskNotFound() {
  return (
    <div className="grid min-h-[60dvh] place-items-center px-6">
      <EmptyState
        icon={IconMessageXCircle}
        title="This chat doesn’t exist or you don’t have access"
        description="The link may be broken, or it points at a task in another workspace."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/app">Back to your tasks</Link>
          </Button>
        }
      />
    </div>
  );
}
