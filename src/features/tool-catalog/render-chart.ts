import { z } from 'zod';
import type { CustomToolDeclaration } from './types';

const RENDER_CHART_NAME = 'render_chart';

const CHART_TYPES = ['bar', 'line', 'area', 'pie'] as const;
const CHART_FORMATS = ['number', 'percent'] as const;

const chartSeriesSchema = z
  .object({
    key: z.string().min(1).max(120),
    label: z.string().min(1).max(120),
  })
  .strict();

const chartRowSchema = z
  .object({
    label: z.string().min(1).max(120),
  })
  .catchall(z.unknown());

const chartSpecBaseSchema = z.object({
  type: z.enum(CHART_TYPES),
  title: z.string().min(1).max(120),
  description: z.string().max(200).optional(),
  data: z.array(chartRowSchema).min(1).max(500),
  series: z.array(chartSeriesSchema).min(1).max(6),
  x_label: z.string().min(1).max(120).optional(),
  y_label: z.string().min(1).max(120).optional(),
  stacked: z.boolean().default(false),
  format: z.enum(CHART_FORMATS).default('number'),
});

type ChartSpecValue = z.infer<typeof chartSpecBaseSchema>;

function validateChartSpec(spec: ChartSpecValue, ctx: z.RefinementCtx): void {
  const keys = spec.series.map((series) => series.key);
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({
      code: 'custom',
      message: 'Series keys must be unique.',
      path: ['series'],
    });
  }
  if (keys.includes('label')) {
    ctx.addIssue({
      code: 'custom',
      message: 'The label field cannot also be a series key.',
      path: ['series'],
    });
  }
  if (spec.type === 'pie' && spec.series.length !== 1) {
    ctx.addIssue({
      code: 'custom',
      message: 'Pie charts require exactly one series.',
      path: ['series'],
    });
  }
  if (spec.stacked && spec.type !== 'bar' && spec.type !== 'area') {
    ctx.addIssue({
      code: 'custom',
      message: 'Only bar and area charts can be stacked.',
      path: ['stacked'],
    });
  }

  const allowedKeys = new Set(['label', ...keys]);
  spec.data.forEach((row, rowIndex) => {
    for (const key of keys) {
      if (typeof row[key] !== 'number' || !Number.isFinite(row[key])) {
        ctx.addIssue({
          code: 'custom',
          message: `Every row requires a finite number for series "${key}".`,
          path: ['data', rowIndex, key],
        });
      }
    }
    for (const key of Object.keys(row)) {
      if (!allowedKeys.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: `Row field "${key}" is not declared in series.`,
          path: ['data', rowIndex, key],
        });
      }
    }
  });
}

export const RenderChartInputSchema = chartSpecBaseSchema.strict().superRefine(validateChartSpec);
const RenderChartRendererSchema = chartSpecBaseSchema.strip().superRefine(validateChartSpec);
export const RenderChartOutputSchema = z
  .object({
    ok: z.literal(true),
    title: z.string().min(1).max(120),
    rows: z.number().int().min(1).max(500),
  })
  .strict();

export type RenderChartSpec = z.infer<typeof RenderChartInputSchema>;
export type RenderChartOutput = z.infer<typeof RenderChartOutputSchema>;

export const RENDER_CHART_DECL: CustomToolDeclaration<typeof RENDER_CHART_NAME> = {
  name: RENDER_CHART_NAME,
  description:
    'Draw a clean bar, line, area, or pie chart in the conversation from labeled numeric data. Percent values use 0 to 100, not fractions. The chart stays in the conversation and can open in the shared canvas. Exporting a PNG or Library file is not supported.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: [...CHART_TYPES] },
      title: { type: 'string', minLength: 1, maxLength: 120 },
      description: { type: 'string', maxLength: 200 },
      data: {
        type: 'array',
        minItems: 1,
        maxItems: 500,
        items: {
          type: 'object',
          properties: { label: { type: 'string', minLength: 1, maxLength: 120 } },
          required: ['label'],
          additionalProperties: { type: 'number' },
        },
      },
      series: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key: { type: 'string', minLength: 1, maxLength: 120 },
            label: { type: 'string', minLength: 1, maxLength: 120 },
          },
          required: ['key', 'label'],
        },
      },
      x_label: { type: 'string', minLength: 1, maxLength: 120 },
      y_label: { type: 'string', minLength: 1, maxLength: 120 },
      stacked: { type: 'boolean' },
      format: { type: 'string', enum: [...CHART_FORMATS] },
    },
    required: ['type', 'title', 'data', 'series'],
  },
};

export function parseChartSpecValue(value: unknown): RenderChartSpec | null {
  const parsed = RenderChartRendererSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function renderChartResult(spec: RenderChartSpec): Promise<RenderChartOutput> {
  return { ok: true, title: spec.title, rows: spec.data.length };
}
