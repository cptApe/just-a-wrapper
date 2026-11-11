// The title-line blues are literal search-result values, not theme tokens, so
// the preview matches what a visitor sees.

function breadcrumb(host: string, route: string): string {
  const segments = route.split('/').filter(Boolean);
  return [host, ...segments].join(' › ');
}

export function SearchResultPreview({
  siteName,
  host,
  route,
  title,
  description,
}: {
  siteName: string;
  host: string;
  route: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col rounded-lg bg-alpha-6 p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background">
          {/* eslint-disable-next-line @next/next/no-img-element -- the site's real favicon route, as the ICO because the SVG follows the OS theme and this card follows the app theme */}
          <img src="/favicon.ico" alt="" width={16} height={16} className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-meta font-medium text-foreground" translate="no">
            {siteName}
          </span>
          <span className="truncate text-meta font-medium text-muted-foreground" translate="no">
            {breadcrumb(host, route)}
          </span>
        </span>
      </div>

      <p className="pt-2.5 text-balance text-body-lg leading-snug text-info">{title}</p>
      <p className="line-clamp-2 pt-1 text-meta text-muted-foreground">{description}</p>
    </div>
  );
}
