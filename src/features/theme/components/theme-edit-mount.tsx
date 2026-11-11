import { captureException } from '@/lib/observability';
import { withRequestContext } from '@/lib/request-context';
import { readThemeTokens } from '../api/read-theme-tokens';
import { ThemeEditController } from './theme-edit-controller';

// Theme editing is optional; an unavailable source file must not prevent opening the app.
export async function ThemeEditMount() {
  const tokens = await withRequestContext({ route: 'theme-edit-mount' }, async () => {
    try {
      return await readThemeTokens();
    } catch (error) {
      captureException(error, { route: 'theme-edit-mount', op: 'read-theme-tokens' });
      return null;
    }
  });
  if (!tokens) return null;
  return <ThemeEditController tokens={tokens} />;
}
