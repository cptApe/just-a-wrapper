import { OgImage } from './og-image';

export function SocialCardPreview({
  host,
  title,
  description,
}: {
  host: string;
  title: string;
  description: string;
}) {
  return (
    <figure className="flex w-full flex-col overflow-hidden rounded-lg bg-alpha-6">
      <OgImage alt="" />
      <figcaption className="flex min-w-0 flex-col gap-0.5 px-3.5 py-3">
        <span className="truncate text-meta font-medium text-muted-foreground" translate="no">
          {host}
        </span>
        <span className="text-balance text-title-card">{title}</span>
        <span className="line-clamp-2 text-meta text-muted-foreground">{description}</span>
      </figcaption>
    </figure>
  );
}
