import type { z } from 'zod';
import type {
  CustomTool,
  StoredToolSettings,
  ToolContext,
  ToolRuntimeDeclaration,
} from '@/features/tool-catalog/types';
import type { MediaBilling } from '@/lib/media-billing';

export type PreparedTool = {
  input: Record<string, unknown>;
  /** Present on a tool that spends vendor money; the dispatcher gates the run on it. */
  estimateCredits: ((settings: StoredToolSettings) => number) | undefined;
  run(context: ToolContext): Promise<{
    output: unknown;
    vendorCostCents: number | undefined;
    mediaBilling: MediaBilling | undefined;
  }>;
};
export type BoundTool = ToolRuntimeDeclaration & {
  accrualSource: 'tool_call' | 'generation';
  /** Whether the tool declares a spend estimate, so every run passes the spend gate. */
  paid: boolean;
  prepare(
    raw: unknown,
  ): { success: true; data: PreparedTool } | { success: false; error: z.ZodError };
};

export function bindTool<I, O>(tool: CustomTool<I, O>): BoundTool {
  return {
    name: tool.name,
    description: tool.description,
    riskLevel: tool.riskLevel,
    alwaysAsk: tool.alwaysAsk,
    inputJsonSchema: tool.inputJsonSchema,
    accrualSource: tool.accrualSource ?? 'tool_call',
    paid: tool.estimateCredits !== undefined,
    prepare(raw) {
      const parsed = tool.inputSchema.safeParse(raw);
      if (!parsed.success) return parsed;
      const estimate = tool.estimateCredits;
      return {
        success: true,
        data: {
          input: parsed.data,
          estimateCredits: estimate ? (settings) => estimate(parsed.data, settings) : undefined,
          async run(context) {
            const output = tool.outputSchema.parse(await tool.handler(parsed.data, context));
            return {
              output,
              vendorCostCents: tool.measureVendorCostCents?.(parsed.data, output),
              mediaBilling: tool.mediaBilling?.(output),
            };
          },
        },
      };
    },
  };
}
