'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
import { IconExpand01 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { buildOverlayHash } from '@/features/overlays/lib/hash';
import { openOverlay } from '@/features/overlays/lib/overlay-history';
import { parseChartSpecValue, type RenderChartSpec } from '@/features/tool-catalog/render-chart';
import { formatNumber, formatPercent } from '@/lib/format/format-number';
import { stageChartOverlay } from './chart-overlay-source';
import { MediaShimmer } from './media-shimmer';
import type { ToolRendererProps } from './tool-renderer-types';

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
] as const;

function formatValue(value: number, format: RenderChartSpec['format']): string {
  return format === 'percent' ? formatPercent(value, 2) : formatNumber(value, 2);
}

function chartConfig(spec: RenderChartSpec): ChartConfig {
  return Object.fromEntries(
    spec.series.map((series) => [series.key, { label: series.label }]),
  ) satisfies ChartConfig;
}

function CartesianAxes({ spec }: { spec: RenderChartSpec }) {
  return (
    <>
      <CartesianGrid vertical={false} stroke="var(--border)" />
      <XAxis
        dataKey="label"
        tickLine={false}
        axisLine={false}
        tickMargin={10}
        minTickGap={20}
        label={
          spec.x_label ? { value: spec.x_label, position: 'insideBottom', offset: -4 } : undefined
        }
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        width="auto"
        tickFormatter={(value: number) => formatValue(value, spec.format)}
        label={
          spec.y_label ? { value: spec.y_label, angle: -90, position: 'insideLeft' } : undefined
        }
      />
    </>
  );
}

function SharedChartChrome({ spec }: { spec: RenderChartSpec }) {
  return (
    <>
      <ChartTooltip
        cursor={{ fill: 'var(--muted)' }}
        content={
          <ChartTooltipContent valueFormatter={(value) => formatValue(value, spec.format)} />
        }
      />
      {spec.series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
    </>
  );
}

function RenderedChart({ spec }: { spec: RenderChartSpec }) {
  const config = chartConfig(spec);
  const commonClassName = 'h-64 w-full min-w-0';

  switch (spec.type) {
    case 'bar':
      return (
        <ChartContainer
          config={config}
          className={commonClassName}
          data-chart-frame
          data-rendered-chart="bar"
        >
          <BarChart accessibilityLayer data={spec.data} margin={{ left: 4, right: 4, bottom: 12 }}>
            <CartesianAxes spec={spec} />
            <SharedChartChrome spec={spec} />
            {spec.series.map((series, index) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                fill={CHART_COLORS[index]}
                stackId={spec.stacked ? 'chart' : undefined}
                radius={spec.stacked ? 0 : 4}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ChartContainer>
      );
    case 'line':
      return (
        <ChartContainer
          config={config}
          className={commonClassName}
          data-chart-frame
          data-rendered-chart="line"
        >
          <LineChart
            accessibilityLayer
            data={spec.data}
            margin={{ left: 4, right: 12, bottom: 12 }}
          >
            <CartesianAxes spec={spec} />
            <SharedChartChrome spec={spec} />
            {spec.series.map((series, index) => (
              <Line
                key={series.key}
                type="monotone"
                dataKey={series.key}
                stroke={CHART_COLORS[index]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      );
    case 'area':
      return (
        <ChartContainer
          config={config}
          className={commonClassName}
          data-chart-frame
          data-rendered-chart="area"
        >
          <AreaChart
            accessibilityLayer
            data={spec.data}
            margin={{ left: 4, right: 12, bottom: 12 }}
          >
            <CartesianAxes spec={spec} />
            <SharedChartChrome spec={spec} />
            {spec.series.map((series, index) => (
              <Area
                key={series.key}
                type="monotone"
                dataKey={series.key}
                stroke={CHART_COLORS[index]}
                fill={CHART_COLORS[index]}
                fillOpacity={0.16}
                stackId={spec.stacked ? 'chart' : undefined}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      );
    case 'pie': {
      const series = spec.series.at(0);
      if (!series) return null;
      return (
        <ChartContainer
          config={config}
          className={commonClassName}
          data-chart-frame
          data-rendered-chart="pie"
        >
          <PieChart accessibilityLayer>
            <ChartTooltip
              content={
                <ChartTooltipContent
                  nameKey="label"
                  valueFormatter={(value) => formatValue(value, spec.format)}
                />
              }
            />
            <Pie
              data={spec.data}
              dataKey={series.key}
              nameKey="label"
              innerRadius="42%"
              outerRadius="72%"
              paddingAngle={2}
              stroke="var(--background)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {spec.data.map((row, index) => (
                <Cell
                  key={`${row.label}-${index}`}
                  fill={CHART_COLORS[index % CHART_COLORS.length]}
                />
              ))}
              <LabelList dataKey="label" position="outside" className="fill-muted-foreground" />
            </Pie>
          </PieChart>
        </ChartContainer>
      );
    }
  }
}

export function ChartPreview({ item, status }: ToolRendererProps) {
  if (status === 'running') {
    return <MediaShimmer sizeClassName="h-64 w-full max-w-2xl" />;
  }
  if (status !== 'done' || !item.result) return null;

  const spec = parseChartSpecValue(item.input);
  if (!spec) return null;

  return (
    <section
      className="w-full max-w-2xl rounded-xl border border-border bg-background p-4"
      aria-label={spec.title}
      data-chart-preview
      data-chart-type={spec.type}
      data-testid={`chart-preview-${spec.type}`}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-title-card text-foreground">{spec.title}</h3>
          {spec.description ? (
            <p className="mt-0.5 text-meta font-medium text-muted-foreground">{spec.description}</p>
          ) : null}
        </div>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="shrink-0 text-muted-foreground"
          onClick={() => {
            stageChartOverlay(item.id, spec);
            openOverlay(buildOverlayHash('chart', item.id));
          }}
          data-chart-open
        >
          <IconExpand01 aria-hidden className="size-3.5" />
          Open
        </Button>
      </header>
      {spec.series.length > 1 ? (
        <span className="sr-only" data-chart-series>
          {spec.series.map((series) => series.label).join(', ')}
        </span>
      ) : null}
      <RenderedChart spec={spec} />
    </section>
  );
}
