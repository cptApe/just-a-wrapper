import { lazy, Suspense } from 'react';
import { parseChartSpecValue } from '@/features/tool-catalog/render-chart';
import type { ToolChatItem } from '../../lib/chat-state';
import { MediaShimmer } from './media-shimmer';
import type { ToolRendererProps } from './tool-renderer-types';

// render_chart: keep Recharts out of the baseline chat bundle.
const LazyChartPreview = lazy(() =>
  import('./chart-preview').then(({ ChartPreview }) => ({ default: ChartPreview })),
);

export function ChartPreviewLoader(props: ToolRendererProps) {
  return (
    <Suspense fallback={<MediaShimmer sizeClassName="h-64 w-full max-w-2xl" />}>
      <LazyChartPreview {...props} />
    </Suspense>
  );
}

export function hasRenderableChart(item: ToolChatItem): boolean {
  return item.result !== undefined && parseChartSpecValue(item.input) !== null;
}
