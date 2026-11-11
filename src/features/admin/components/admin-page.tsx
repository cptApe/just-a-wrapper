import { type AdminPageSlug, adminPageMeta } from '../registry';
import { AdminSourceFootnotes } from './source-footnotes';

export function AdminPage({ slug, children }: { slug: AdminPageSlug; children: React.ReactNode }) {
  const meta = adminPageMeta(slug);

  return (
    <main className="mx-auto w-full max-w-page-reading px-4 pb-24 pt-6 sm:px-6 md:px-10 md:pt-12">
      <div className="flex flex-col gap-11">
        <header>
          <h1 className="text-balance text-title-page">{meta.title}</h1>
        </header>
        <div data-admin-page-content className="flex flex-col gap-14">
          {children}
        </div>
      </div>
      {/* Outside the content wrapper so the table of contents skips its h2. */}
      <AdminSourceFootnotes files={meta.sourceFiles} />
    </main>
  );
}
