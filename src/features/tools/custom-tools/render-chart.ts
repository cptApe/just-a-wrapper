import 'server-only';
import {
  RENDER_CHART_DECL,
  RenderChartInputSchema,
  type RenderChartOutput,
  RenderChartOutputSchema,
  type RenderChartSpec,
  renderChartResult,
} from '@/features/tool-catalog/render-chart';
import type { CustomTool } from '@/features/tool-catalog/types';

export const renderChartTool: CustomTool<RenderChartSpec, RenderChartOutput> = {
  ...RENDER_CHART_DECL,
  inputSchema: RenderChartInputSchema,
  outputSchema: RenderChartOutputSchema,
  async handler(spec) {
    return renderChartResult(spec);
  },
};
