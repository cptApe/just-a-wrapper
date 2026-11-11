'use client';

import { PreviewSurface } from '@/components/ui/preview-surface';
import type { OverlayComponentProps } from '@/features/overlays/types';
import { readStagedChartOverlay } from './chart-overlay-source';
import { ChartPreview } from './chart-preview';

export function ChartOverlay({ id, open, onClose }: OverlayComponentProps) {
  const spec = readStagedChartOverlay(id);
  const item = {
    type: 'tool' as const,
    id: id ?? 'chart-overlay',
    tool: 'custom' as const,
    name: 'render_chart',
    input: spec ?? {},
    result: spec
      ? {
          isError: false,
          text: JSON.stringify({ ok: true, title: spec.title, rows: spec.data.length }),
        }
      : undefined,
  };

  return (
    <PreviewSurface
      kind="chart"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={spec?.title ?? 'Chart unavailable'}
    >
      {spec?.description ? (
        <p className="pb-3 text-meta text-muted-foreground">{spec.description}</p>
      ) : null}
      {spec ? null : (
        <p className="text-body text-muted-foreground">
          This chart can’t be reopened from a link. Open it from its task.
        </p>
      )}
      <div className="h-full [&_[data-chart-frame]]:h-[min(70dvh,36rem)] [&_[data-chart-open]]:hidden [&_[data-chart-preview]]:max-w-none [&_[data-chart-preview]]:border-0 [&_[data-chart-preview]]:bg-transparent [&_[data-chart-preview]]:p-0 [&_[data-chart-preview]>header]:hidden">
        <ChartPreview item={item} status="done" />
      </div>
    </PreviewSurface>
  );
}
