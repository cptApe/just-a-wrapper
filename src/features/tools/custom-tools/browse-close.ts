import 'server-only';
import type { z } from 'zod';
import type { CustomTool } from '@/features/tool-catalog/types';
import { BROWSE_CLOSE_DECL } from '@/features/tool-catalog/web-declarations';
import { closeTaskBrowser } from '../api/browser-session';
import { browseCloseInput, browseCloseOutput } from '../lib/browser-tool-contracts';

export const browseCloseTool: CustomTool<
  z.infer<typeof browseCloseInput>,
  z.infer<typeof browseCloseOutput>
> = {
  ...BROWSE_CLOSE_DECL,
  inputSchema: browseCloseInput,
  outputSchema: browseCloseOutput,
  async handler(_input, ctx) {
    return closeTaskBrowser(ctx.sessionRowId);
  },
};
