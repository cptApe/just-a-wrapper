import { Badge } from '@/components/ui/badge';
import type { ReviewOutcome } from '@/features/tasks';

const REVIEW_COPY: Record<ReviewOutcome, string> = {
  passed: 'Passed review',
  passed_after_revision: 'Passed after revision',
  not_passed: 'Finished, review not passed',
};

export function ReviewBadge({ outcome }: { outcome: ReviewOutcome }) {
  return (
    <Badge
      variant={outcome === 'not_passed' ? 'destructive' : 'success'}
      className={`w-fit max-w-full text-on-media ${outcome === 'not_passed' ? 'bg-schedule-review-fail' : 'bg-schedule-review-pass'}`}
      title={REVIEW_COPY[outcome]}
    >
      <span className="truncate">{REVIEW_COPY[outcome]}</span>
    </Badge>
  );
}
