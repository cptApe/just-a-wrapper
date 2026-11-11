// The app shell composes every feature's overlay; the overlays feature itself imports none.
// Import client components directly: server API barrels cannot enter this graph.
import { type ComponentType, lazy, Suspense } from 'react';
import { PreviewSurface } from '@/components/ui/preview-surface';
import { PlansOverlay } from '@/features/billing/components/plan-dialog';
import { TopupOverlay } from '@/features/billing/components/topup-dialog';
import { MediaShimmer } from '@/features/chat/components/tool-renderers/media-shimmer';
import { FeedbackOverlay } from '@/features/feedback/components/feedback-overlay';
import { FilePreviewOverlay } from '@/features/files/components/file-preview-overlay';
import { NewFolderOverlay } from '@/features/files/components/new-folder-overlay';
import { NewNoteOverlay } from '@/features/files/components/new-note-overlay';
import { SessionFilesOverlay } from '@/features/files/components/session-files-overlay';
import { AppDetailOverlay } from '@/features/integrations/components/app-detail-overlay';
import { MemoryNoteOverlay } from '@/features/memory/components/memory-note-overlay';
import { NotificationsOverlay } from '@/features/notifications/components/notifications-overlay';
import type { OverlayComponentProps, OverlayToken } from '@/features/overlays';
import { NewScheduleOverlay } from '@/features/scheduled/components/new-schedule-dialog';
import { SkillInspectorOverlay } from '@/features/skills/components/skill-inspector-overlay';
import { BrowserSessionOverlay } from '@/features/tools/components/browser-session-overlay';
import { CreateWorkspaceOverlay } from '@/features/workspaces/components/create-workspace-dialog';

// render_chart: keep Recharts and the chart canvas out of the baseline overlay bundle.
const LazyChartOverlay = lazy(() =>
  import('@/features/chat/components/tool-renderers/chart-overlay').then(({ ChartOverlay }) => ({
    default: ChartOverlay,
  })),
);

function ChartOverlayLoader(props: OverlayComponentProps) {
  return (
    <Suspense
      fallback={
        <PreviewSurface
          kind="chart"
          open={props.open}
          onOpenChange={(next) => {
            if (!next) props.onClose();
          }}
          title="Drawing a chart"
        >
          <MediaShimmer sizeClassName="h-[min(70dvh,36rem)] w-full" />
        </PreviewSurface>
      }
    >
      <LazyChartOverlay {...props} />
    </Suspense>
  );
}

export const OVERLAY_REGISTRY: Record<OverlayToken, ComponentType<OverlayComponentProps>> = {
  browser: BrowserSessionOverlay,
  notifications: NotificationsOverlay,
  file: FilePreviewOverlay,
  'task-file': SessionFilesOverlay,
  memory: MemoryNoteOverlay,
  app: AppDetailOverlay,
  skill: SkillInspectorOverlay,
  feedback: FeedbackOverlay,
  'new-schedule': NewScheduleOverlay,
  'new-workspace': CreateWorkspaceOverlay,
  'new-folder': NewFolderOverlay,
  'new-note': NewNoteOverlay,
  chart: ChartOverlayLoader,
  topup: TopupOverlay,
  plans: PlansOverlay,
};
