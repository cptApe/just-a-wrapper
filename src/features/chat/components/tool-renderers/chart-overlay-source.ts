import type { RenderChartSpec } from '@/features/tool-catalog/render-chart';

type StagedChart = { toolCallId: string; spec: RenderChartSpec };

let stagedChart: StagedChart | null = null;

export function stageChartOverlay(toolCallId: string, spec: RenderChartSpec): void {
  stagedChart = { toolCallId, spec };
}

export function readStagedChartOverlay(toolCallId: string | null): RenderChartSpec | null {
  return toolCallId !== null && stagedChart?.toolCallId === toolCallId ? stagedChart.spec : null;
}
