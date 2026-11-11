import 'server-only';
import type { z } from 'zod';
import type { CustomTool } from '@/features/tool-catalog/types';
import { BROWSE_ACT_DECL } from '@/features/tool-catalog/web-declarations';
import { actInTaskBrowser } from '../api/browser-actions';
import { browseActInput, browseActOutput } from '../lib/browser-tool-contracts';
import { vendorCallEstimateCredits } from '../lib/vendor-estimates';

export const browseActTool: CustomTool<
  z.infer<typeof browseActInput>,
  z.infer<typeof browseActOutput>
> = {
  ...BROWSE_ACT_DECL,
  inputSchema: browseActInput,
  outputSchema: browseActOutput,
  accrualSource: 'generation',
  measureVendorCostCents: (_input, output) => output.vendorCostCents,
  estimateCredits: vendorCallEstimateCredits,
  async handler({ instruction, operation }, ctx) {
    return actInTaskBrowser({ instruction, operation, sessionRowId: ctx.sessionRowId });
  },
};
