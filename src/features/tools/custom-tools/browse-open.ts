import 'server-only';
import type { z } from 'zod';
import type { CustomTool } from '@/features/tool-catalog/types';
import { BROWSE_OPEN_DECL } from '@/features/tool-catalog/web-declarations';
import { openTaskBrowser } from '../api/browser-session';
import { browseOpenInput, browseOpenOutput } from '../lib/browser-tool-contracts';
import { browserStartEstimateCredits } from '../lib/vendor-estimates';

export const browseOpenTool: CustomTool<
  z.infer<typeof browseOpenInput>,
  z.infer<typeof browseOpenOutput>
> = {
  ...BROWSE_OPEN_DECL,
  inputSchema: browseOpenInput,
  outputSchema: browseOpenOutput,
  estimateCredits: browserStartEstimateCredits,
  async handler({ url }, ctx) {
    const opened = await openTaskBrowser({
      url,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      sessionRowId: ctx.sessionRowId,
    });
    return {
      ...opened,
      message: 'The browser is open. The user can watch it live or take control.',
    };
  },
};
