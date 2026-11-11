import { notFound } from 'next/navigation';
import { adminPageMeta, adminSourcesMarkdown, isAdminPageSlug } from '@/features/admin';
import { ADMIN_MD_SOURCES } from '@/features/admin/server';
import { withRequestContext } from '@/lib/request-context';
import { requireAdminAccess } from '../../admin-access';

// Route handlers do not run the `(admin)` group layout, so they call its gate.
export function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  return withRequestContext({ route: 'admin-markdown/[slug]' }, async () => {
    await requireAdminAccess();

    const { slug } = await params;
    if (!isAdminPageSlug(slug)) notFound();

    const body = await ADMIN_MD_SOURCES[slug]();
    const markdown = `${body.trimEnd()}\n\n${adminSourcesMarkdown(adminPageMeta(slug))}\n`;

    return new Response(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'X-Robots-Tag': 'noindex',
      },
    });
  });
}
